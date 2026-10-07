import { deferred, waitUntil } from "./deferred";
import { expect, test } from "bun:test";
import { NativeFontSession } from "../../src/services/font-session";
import { NativeSettingsSession } from "../../src/services/settings-session";
import {
  normalize,
  type Settings,
  type ExclusiveRunner,
} from "../../src/domain/settings/schema";
import { createQueuedExclusiveRunner } from "../../src/services/settings-transactions";
import type { FontEnvironment } from "../../src/services/custom-font-loading";
import { expectRejected } from "../platform/rejection";
function fixture() {
  let durable = normalize(null);
  const listeners = new Set<(value: unknown) => void>();
  let release: (() => void) | undefined;
  const registered = new Set<FontFace>();
  const queue = createQueuedExclusiveRunner();
  let queued = 0;
  const runner: ExclusiveRunner = (work) => {
    queued++;
    return queue(work);
  };
  const session = new NativeSettingsSession(
    {
      read: () => Promise.resolve(durable),
      write: (_key, raw) => {
        const next = normalize(raw);
        durable = next;
        for (const listener of listeners) listener(next);
        return next.fonts === "custom"
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : Promise.resolve();
      },
      subscribe: (_key, listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    runner,
    false,
  );
  class Face {
    status = "unloaded";
    constructor(
      readonly family: string,
      readonly source: string,
      readonly descriptors: FontFaceDescriptors,
    ) {}
    load() {
      this.status = "loaded";
      return Promise.resolve(this as unknown as FontFace);
    }
  }
  const env: FontEnvironment = {
    fonts: registered as unknown as FontFaceSet,
    remoteAllowed: () => true,
    fetch: () =>
      Promise.resolve(
        new Response(
          '@font-face { font-style:normal; font-weight:400; src:url(https://fonts.gstatic.com/s/inter/v1/test.woff2) format("woff2"); }',
        ),
      ),
    createFace: (...args) => new Face(...args) as unknown as FontFace,
  };
  // FontFaceSet.delete/add map to Set, including the disposal ownership used by the loader.
  let active = true,
    requests = 0;
  const activityListeners = new Set<(active: boolean) => void>();
  const fetch = env.fetch.bind(env);
  env.fetch = (...args) => {
    requests++;
    return fetch(...args);
  };
  const fonts = new NativeFontSession(session, env, {
    isActive: () => active,
    subscribe: (listener) => {
      activityListeners.add(listener);
      return () => {
        activityListeners.delete(listener);
      };
    },
  });
  return {
    session,
    fonts,
    env,
    requests: () => requests,
    runner,
    queued: () => queued,
    activity: (value: boolean) => {
      active = value;
      for (const listener of activityListeners) listener(value);
    },
    registered,
    external: (next: Settings) => {
      durable = next;
      for (const listener of listeners) listener(next);
    },
    release: () => {
      if (!release) throw new Error("No held save");
      release();
    },
    isHeld: () => !!release,
  };
}
test("external tuple after own durable echo wins; late save faces are disposed, current offline roles load", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const original = h.fonts.current().display;
  const saving = h.fonts.save("Inter", "Inter");
  const outcome = saving.catch((error: unknown) => error);
  for (let i = 0; i < 100 && !h.isHeld(); i++) await Promise.resolve();
  expect(h.isHeld()).toBe(true);
  expect(h.fonts.current().display).toEqual(original);
  expect(h.registered.size).toBeGreaterThan(0);
  h.external(
    normalize({
      fonts: "custom",
      customDisplayFont: "Georgia",
      customBodyFont: "Arial",
    }),
  );
  h.release();
  expect(await outcome).toBeInstanceOf(Error);
  for (let i = 0; i < 100 && h.fonts.current().display?.name !== "Georgia"; i++)
    await Promise.resolve();
  expect(h.fonts.current().display?.name).toBe("Georgia");
  expect(h.fonts.current().body?.name).toBe("Arial");
  expect(h.registered.size).toBe(0);
  h.fonts.dispose();
  h.session.destroy();
});
test("cancelling a pending request never changes durable tuple or removes active offline role", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const active = h.fonts.current().display;
  const saving = h.fonts.save("Inter", "Inter");
  h.fonts.cancel();
  await expectRejected(saving, /Cancelled|superseded/);
  expect(h.session.current().durable.fonts).toBe("system");
  expect(h.fonts.current().display).toEqual(active);
  expect(h.registered.size).toBe(0);
  h.fonts.dispose();
  h.session.destroy();
});
test("preview has separate ownership and disposal releases staged save faces even before held persistence settles", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const preview = await h.fonts.preview("Inter", "Inter");
  expect(h.session.current().durable.fonts).toBe("system");
  expect(h.fonts.current().display?.source).toBe("system");
  expect(h.registered.size).toBe(2);
  preview.dispose();
  expect(h.registered.size).toBe(0);
  const saving = h.fonts.save("Inter", "Inter");
  const outcome = saving.catch((error: unknown) => error);
  for (let i = 0; i < 100 && !h.isHeld(); i++) await Promise.resolve();
  expect(h.isHeld()).toBe(true);
  expect(h.registered.size).toBe(2);
  h.fonts.dispose();
  expect(h.registered.size).toBe(0);
  h.release();
  expect(await outcome).toBeInstanceOf(Error);
  h.session.destroy();
});
test("font family snapshots cannot mutate the active role catalog or another subscriber", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const snapshot = h.fonts.current();
  if (!snapshot.display) throw new Error("Missing active family");
  snapshot.display.name = "Mutated";
  snapshot.display.stack = "bad";
  expect(h.fonts.current().display?.name).toBe("system-ui");
  expect(h.fonts.current().display?.stack).not.toBe("bad");
  h.fonts.dispose();
  h.session.destroy();
});
test("cancel after own durable echo reconciles committed font roles when persistence settles", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const work = h.fonts.save("Inter", "Inter");
  const outcome = work.catch((error: unknown) => error);
  await waitUntil(h.isHeld);
  expect(h.session.current().durable.fonts).toBe("custom");
  h.fonts.cancel();
  h.release();
  await outcome;
  expect(h.fonts.current().state).toBe("ready");
  expect(h.fonts.current().display?.name).toBe("Inter");
  expect(h.fonts.current().body?.name).toBe("Inter");
  h.fonts.dispose();
  h.session.destroy();
});
test("automatic font focus cycles reuse the active tuple; explicit retry still reloads", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  h.external(
    normalize({
      fonts: "custom",
      customDisplayFont: "Inter",
      customBodyFont: "Inter",
    }),
  );
  await waitUntil(
    () =>
      h.fonts.current().state === "ready" &&
      h.fonts.current().display?.name === "Inter",
  );
  const count = h.requests(),
    stack = h.fonts.current().display?.stack;
  h.activity(false);
  h.activity(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(h.requests()).toBe(count);
  expect(h.fonts.current().display?.stack).toBe(stack);
  await h.fonts.retry();
  expect(h.requests()).toBeGreaterThan(count);
  h.fonts.dispose();
  h.session.destroy();
});
test("preview defers while inactive and pending preview is cancelled on focus loss, without affecting active faces", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  h.activity(false);
  const preview = h.fonts.preview("Inter", "Inter");
  await Promise.resolve();
  expect(h.requests()).toBe(0);
  h.activity(true);
  const ready = await preview;
  ready.dispose();
  const css = deferred<Response>();
  let started = false;
  h.env.fetch = () => {
    started = true;
    return css.promise;
  };
  const pending = h.fonts.preview("Inter", "Inter");
  const outcome = pending.catch((error: unknown) => error);
  await waitUntil(() => started);
  h.activity(false);
  css.resolve(
    new Response(
      "@font-face{font-weight:400;src:url(https://fonts.gstatic.com/s/inter/v1/test.woff2)}",
    ),
  );
  expect(await outcome).toBeInstanceOf(Error);
  expect(h.registered.size).toBe(0);
  expect(h.fonts.current().display?.name).toBe("system-ui");
  h.fonts.dispose();
  h.session.destroy();
});
test("cancelled submitted save reconciliation cannot overwrite a newer held font save", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const old = h.fonts.save("Inter", "Inter").catch((error: unknown) => error);
  await waitUntil(h.isHeld);
  h.fonts.cancel();
  const next = h.fonts.save("Georgia", "Arial");
  h.release();
  await old;
  await waitUntil(
    () => h.session.current().durable.customDisplayFont === "Georgia",
  );
  expect(h.fonts.current().state).toBe("loading");
  h.release();
  await next;
  expect(h.fonts.current().display?.name).toBe("Georgia");
  expect(h.fonts.current().body?.name).toBe("Arial");
  h.fonts.dispose();
  h.session.destroy();
});
test("authorization revoked while a verified font write is queued prevents persistence", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const gate = deferred<undefined>();
  const before = h.queued();
  const blocker = h.runner(() => gate.promise);
  const saving = h.fonts.save("Inter", "Inter");
  const outcome = saving.catch((error: unknown) => error);
  await waitUntil(() => h.queued() === before + 2);
  h.env.remoteAllowed = () => false;
  h.fonts.authorizationChanged();
  gate.resolve(undefined);
  await blocker;
  expect(await outcome).toBeInstanceOf(Error);
  expect(h.session.current().durable.fonts).toBe("system");
  expect(h.registered.size).toBe(0);
  h.fonts.dispose();
  h.session.destroy();
});
test("focus loss does not cancel a submitted user font save or reload it on return", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const work = h.fonts.save("Inter", "Inter");
  await waitUntil(h.isHeld);
  h.activity(false);
  h.release();
  await work;
  expect(h.fonts.current().display?.name).toBe("Inter");
  const requests = h.requests();
  h.activity(true);
  await Promise.resolve();
  expect(h.requests()).toBe(requests);
  h.fonts.dispose();
  h.session.destroy();
});
test("a failed newer draft cannot suppress reconciliation of a cancelled submitted font write", async () => {
  const h = fixture();
  await h.session.reload();
  await h.fonts.retry();
  const old = h.fonts.save("Inter", "Inter").catch((error: unknown) => error);
  await waitUntil(h.isHeld);
  h.fonts.cancel();
  await expectRejected(
    h.fonts.save("Georgia", "Bricolage Grotesque"),
    "Included",
  );
  h.release();
  await old;
  expect(h.fonts.current().state).toBe("ready");
  expect(h.fonts.current().display?.name).toBe("Inter");
  h.fonts.dispose();
  h.session.destroy();
});
