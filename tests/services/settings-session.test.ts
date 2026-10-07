import { deferred } from "./deferred";
import { expect, test } from "bun:test";
import { NativeSettingsSession } from "../../src/services/settings-session";
import {
  normalize,
  mergeSettingsPatch,
  STORAGE_KEY,
} from "../../src/domain/settings/schema";
import { createQueuedExclusiveRunner } from "../../src/services/settings-transactions";
import type { StorageAdapter } from "../../src/platform/storage/browser-storage";
import { expectRejected } from "../platform/rejection";
function fixture() {
  let durable: unknown = normalize(null);
  const listeners = new Set<(value: unknown) => void>();
  const adapter: StorageAdapter = {
    read: () => Promise.resolve(structuredClone(durable)),
    write: (_key, value) => {
      durable = structuredClone(value);
      for (const listener of listeners) listener(value);
      return Promise.resolve();
    },
    subscribe: (_key, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const runner = createQueuedExclusiveRunner(),
    session = new NativeSettingsSession(adapter, runner, true);
  return {
    session,
    runner,
    external: (value: unknown) => {
      durable = value;
      for (const listener of listeners) listener(value);
    },
    read: () => normalize(durable),
  };
}
test("two queued same-document background intents cross only acknowledged revisions", async () => {
  const h = fixture();
  await h.session.reload();
  await Promise.all([
    h.session.patch({ background: "none" }),
    h.session.patch({ background: "waves" }),
  ]);
  expect(h.read().background).toBe("waves");
  expect(h.read().backgroundRevision).toBe(2);
  expect(h.session.current().persistence.status).toBe("saved");
  h.session.destroy();
});
test("external revision invalidates queued background intent but unrelated owned edits survive", async () => {
  const h = fixture();
  await h.session.reload();
  let release: (() => void) | undefined;
  const blocker = h.runner(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  const saving = h.session.patch({ background: "waves" });
  const failed = saving.catch((error: unknown) => error);
  h.external(
    mergeSettingsPatch(h.read(), { background: "none", glassBlur: 40 }),
  );
  if (!release) throw new Error("Missing blocker");
  release();
  await blocker;
  expect(await failed).toBeInstanceOf(Error);
  expect(h.session.current().settings.background).toBe("none");
  expect(h.session.current().settings.glassBlur).toBe(40);
  h.session.destroy();
});
test("strict reload failure remains actionable; no guessed destructive storage write", async () => {
  let writes = 0;
  const session = new NativeSettingsSession(
    {
      read: () => Promise.reject(new Error("unreadable")),
      write: () => {
        writes++;
        return Promise.resolve();
      },
      subscribe: () => () => {},
    },
    createQueuedExclusiveRunner(),
    false,
  );
  await expectRejected(session.reload(), "unreadable");
  expect(session.current().error).toBe("unreadable");
  expect(session.current().ready).toBe(true);
  expect(writes).toBe(0);
  session.destroy();
});
test("snapshots cannot mutate internal settings authority or subscribers", async () => {
  const h = fixture();
  await h.session.reload();
  const snapshot = h.session.current();
  snapshot.settings.theme = "moss";
  snapshot.durable.theme = "ivory";
  expect(h.session.current().durable.theme).toBe("midnight");
  expect(STORAGE_KEY).toBe("lightfield:settings");
  h.session.destroy();
});
test("dirty draft survives cross-tab fields, exact settlement cannot release newer input, cancel removes only its ownership", async () => {
  const h = fixture();
  await h.session.reload();
  const a = h.session.stage({ weatherLocation: "A" });
  expect(h.session.current().persistence.dirty).toBe(1);
  h.external(normalize({ theme: "ivory", weatherLocation: "External" }));
  expect(h.session.current().settings.weatherLocation).toBe("A");
  expect(h.session.current().settings.theme).toBe("ivory");
  const b = h.session.stage({ weatherLocation: "B" });
  await a.commit();
  expect(h.session.current().settings.weatherLocation).toBe("B");
  expect(h.session.current().persistence.dirty).toBe(1);
  b.cancel();
  expect(h.session.current().settings.weatherLocation).toBe("A");
  await expectRejected(b.commit(), "cancelled");
  h.session.destroy();
});
test("external background revision cancels old dirty draft; flushing uses current owned background tickets", async () => {
  const h = fixture();
  await h.session.reload();
  const draft = h.session.stage({ background: "waves" });
  h.external(mergeSettingsPatch(h.read(), { background: "none" }));
  expect(h.session.current().settings.background).toBe("none");
  await expectRejected(draft.commit(), "cancelled");
  h.session.stage({ background: "waves" });
  await h.session.flushBackground();
  expect(h.read().background).toBe("waves");
  expect(h.session.current().persistence.dirty).toBe(0);
  h.session.destroy();
});
test("saved-status timer authority cannot clear a newer dirty field or a later completed save", async () => {
  const h = fixture();
  await h.session.reload();
  await h.session.patch({ theme: "moss" });
  const old = h.session.current().persistenceRevision;
  const draft = h.session.stage({ glassBlur: 40 });
  expect(h.session.clearSavedStatus(old)).toBe(false);
  await draft.commit();
  expect(h.session.clearSavedStatus(old)).toBe(false);
  expect(
    h.session.clearSavedStatus(h.session.current().persistenceRevision),
  ).toBe(true);
  expect(h.session.current().persistence.status).toBe("idle");
  h.session.destroy();
});
test("external background invalidates only that part of a mixed focused draft", async () => {
  const h = fixture();
  await h.session.reload();
  const draft = h.session.stage({
    background: "waves",
    weatherLocation: "London",
  });
  h.external(mergeSettingsPatch(h.read(), { background: "none" }));
  expect(h.session.current().settings).toMatchObject({
    background: "none",
    weatherLocation: "London",
  });
  expect(h.session.current().persistence.dirty).toBe(1);
  await draft.commit();
  expect(h.read()).toMatchObject({
    background: "none",
    weatherLocation: "London",
    backgroundRevision: 1,
  });
  expect(h.session.current().persistence.status).toBe("saved");
  h.session.destroy();
});
test("queued mixed draft commits remaining fields after an external background revision", async () => {
  const h = fixture();
  await h.session.reload();
  const gate = deferred<undefined>();
  const block = h.runner(() => gate.promise);
  await Promise.resolve();
  const draft = h.session.stage({
    background: "waves",
    weatherLocation: "London",
  });
  const work = draft.commit();
  h.external(mergeSettingsPatch(h.read(), { background: "none" }));
  gate.resolve(undefined);
  await block;
  await work;
  expect(h.read()).toMatchObject({
    background: "none",
    weatherLocation: "London",
    backgroundRevision: 1,
  });
  h.session.destroy();
});
