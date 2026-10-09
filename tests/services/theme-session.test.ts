import { expect, test } from "bun:test";
import { NativeThemeSession } from "../../src/services/theme-session";
import { NativeSettingsSession } from "../../src/services/settings-session";
import {
  normalize,
  STORAGE_KEY,
  type ExclusiveRunner,
} from "../../src/domain/settings/schema";
import {
  CUSTOM_THEMES_KEY,
  serializeCustomThemeExport,
} from "../../src/domain/themes/custom-themes";
import type { StorageAdapter } from "../../src/platform/storage/browser-storage";
import { deferred, waitUntil } from "./deferred";
import { expectRejected } from "../platform/rejection";

const one = {
  id: "custom:one",
  name: "One",
  paper: "#11111b",
  ink: "#eeeeee",
  accent: "#74c7ec",
};
const two = { ...one, id: "custom:two", name: "Two" };
function fixture(selected = "midnight") {
  const values = new Map<string, unknown>([
    [STORAGE_KEY, normalize({ theme: selected })],
    [CUSTOM_THEMES_KEY, [one, two]],
  ]);
  const listeners = new Map<string, Set<(raw: unknown) => void>>();
  const external = (key: string, value: unknown) => {
    values.set(key, structuredClone(value));
    for (const listener of listeners.get(key) ?? []) listener(value);
  };
  const storage: StorageAdapter = {
    read: (key) => Promise.resolve(structuredClone(values.get(key))),
    write: (key, value) => {
      external(key, value);
      return Promise.resolve();
    },
    subscribe: (key, listener) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
  let tail = Promise.resolve();
  const exclusive: ExclusiveRunner = (work) => {
    const result = tail.then(work);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const settings = new NativeSettingsSession(storage, exclusive, false);
  let id = 0;
  const themes = new NativeThemeSession(
    storage,
    settings,
    exclusive,
    () => `generated-${String(++id)}`,
  );
  const ready = Promise.all([settings.reload(), themes.load()]);
  return {
    values,
    listeners,
    storage,
    settings,
    themes,
    external,
    ready,
    dispose: () => {
      themes.dispose();
      settings.destroy();
    },
  };
}

test("save new/inactive preserves fresh persisted selection; active edits and renames keep ID", async () => {
  const h = fixture();
  await h.ready;
  h.external(STORAGE_KEY, normalize({ theme: "moss" }));
  await h.themes.save({ ...one, id: "custom:new" }, null);
  await h.themes.save(
    { ...one, name: "Renamed", id: "custom:ignored" },
    one.id,
  );
  expect(h.settings.current().durable.theme).toBe("moss");
  expect(h.themes.current()[0]).toEqual({ ...one, name: "Renamed" });
  await h.settings.patch({ theme: one.id });
  await h.themes.save({ ...one, accent: "#112233" }, one.id);
  expect(h.settings.current().durable.theme).toBe(one.id);
  expect(h.themes.current()[0]).toEqual({ ...one, accent: "#112233" });
  h.dispose();
});

test("individual export uses existing envelope and roundtrips exactly one; missing ID rejects", async () => {
  const h = fixture();
  await h.ready;
  const raw = h.themes.exportOne(two.id);
  expect(raw).toBe(serializeCustomThemeExport([two]));
  expect(h.themes.export()).toBe(serializeCustomThemeExport([one, two]));
  expect(() => h.themes.exportOne("custom:missing")).toThrow(
    "no longer exists",
  );
  h.external(CUSTOM_THEMES_KEY, []);
  await h.themes.import(raw);
  expect(h.themes.current()).toEqual([two]);
  expect(h.settings.current().durable.theme).toBe("midnight");
  h.dispose();
});

test("malformed, oversized and oversized-count imports are atomic", async () => {
  const h = fixture(one.id);
  await h.ready;
  const before = structuredClone(h.values);
  for (const raw of [
    "{",
    "x".repeat(256 * 1024 + 1),
    serializeCustomThemeExport(
      Array.from({ length: 101 }, (_, i) => ({
        ...one,
        id: `custom:${String(i)}`,
      })),
    ),
  ]) {
    await expectRejected(h.themes.import(raw), "Nothing was changed");
    expect(h.values).toEqual(before);
    expect(h.themes.current()).toEqual([one, two]);
  }
  h.dispose();
});

for (const active of [true, false])
  test(`delete ${active ? "active" : "inactive"} and undo preserve appropriate selection`, async () => {
    const h = fixture(active ? one.id : "moss");
    await h.ready;
    await h.themes.remove(one.id);
    expect(h.themes.current()).toEqual([two]);
    expect(h.settings.current().durable.theme).toBe(
      active ? "midnight" : "moss",
    );
    await h.themes.undo();
    expect(h.themes.current()).toEqual([two, one]);
    expect(h.settings.current().durable.theme).toBe(active ? one.id : "moss");
    h.dispose();
  });

for (const source of ["local", "external", "optimistic"] as const)
  test(`undo restores collision with ${source} select-other-then-return guard`, async () => {
    const h = fixture(one.id);
    await h.ready;
    await h.themes.remove(one.id);
    h.external(CUSTOM_THEMES_KEY, [two, { ...one, name: "Other tab" }]);
    if (source === "local") {
      await h.settings.patch({ theme: "moss" });
      await h.settings.patch({ theme: "midnight" });
    } else if (source === "external") {
      h.external(STORAGE_KEY, normalize({ theme: "moss" }));
      h.external(STORAGE_KEY, normalize({ theme: "midnight" }));
    } else {
      const draft = h.settings.stage({ theme: "moss" });
      draft.cancel();
    }
    await h.themes.undo();
    expect(h.settings.current().durable.theme).toBe("midnight");
    expect(h.themes.current()).toEqual([
      two,
      { ...one, name: "Other tab" },
      { ...one, id: "custom:generated-1" },
    ]);
    h.dispose();
  });

test("undo collision without later selection reselects remapped restored ID", async () => {
  const h = fixture(one.id);
  await h.ready;
  await h.themes.remove(one.id);
  h.external(CUSTOM_THEMES_KEY, [one, two]);
  await h.themes.undo();
  expect(h.settings.current().durable.theme).toBe("custom:generated-1");
  h.dispose();
});

test("selection during deletion await is not absorbed by epoch capture", async () => {
  const h = fixture(one.id);
  await h.ready;
  const write = h.storage.write.bind(h.storage);
  const gate = deferred<undefined>();
  let written = false;
  h.storage.write = async (key, value) => {
    await write(key, value);
    if (key === STORAGE_KEY) {
      written = true;
      await gate.promise;
    }
  };
  const removing = h.themes.remove(one.id);
  await waitUntil(() => written);
  const draft = h.settings.stage({ theme: "moss" });
  draft.cancel();
  gate.resolve(undefined);
  await removing;
  await h.themes.undo();
  expect(h.settings.current().durable.theme).toBe("midnight");
  expect(h.themes.current()).toEqual([two, one]);
  h.dispose();
});

for (const selection of ["cancelled", "pending", "external"] as const)
  test(`undo rechecks ${selection} selection after deferred collection write`, async () => {
    const h = fixture(one.id);
    await h.ready;
    await h.themes.remove(one.id);
    const write = h.storage.write.bind(h.storage);
    const gate = deferred<undefined>();
    let collectionWritten = false;
    const submittedSelections: string[] = [];
    h.storage.write = async (key, value) => {
      if (key === STORAGE_KEY) submittedSelections.push(normalize(value).theme);
      await write(key, value);
      if (key === CUSTOM_THEMES_KEY) {
        collectionWritten = true;
        await gate.promise;
      }
    };
    const undoing = h.themes.undo();
    await waitUntil(() => collectionWritten);
    const draft =
      selection === "external" ? null : h.settings.stage({ theme: "moss" });
    if (selection === "cancelled") draft?.cancel();
    if (selection === "external")
      h.external(STORAGE_KEY, normalize({ theme: "moss" }));
    expect(h.settings.current().settings.theme).toBe(
      selection === "cancelled" ? "midnight" : "moss",
    );
    gate.resolve(undefined);
    await undoing;
    expect(h.themes.current()).toEqual([two, one]);
    expect(h.values.get(CUSTOM_THEMES_KEY)).toEqual([two, one]);
    expect(submittedSelections).toEqual([
      selection === "external" ? "moss" : "midnight",
    ]);
    expect(h.settings.current().durable.theme).toBe(
      selection === "external" ? "moss" : "midnight",
    );
    expect(h.settings.current().settings.theme).toBe(
      selection === "cancelled" ? "midnight" : "moss",
    );
    if (selection === "pending") {
      draft?.cancel();
      expect(h.settings.current().settings.theme).toBe("midnight");
    }
    h.dispose();
  });

test("undo retains freshly locked selection when notification is delayed and optimistic selection is cancelled", async () => {
  const h = fixture(one.id);
  await h.ready;
  await h.themes.remove(one.id);
  // Model persisted cross-tab selection before its subscriber notification.
  h.values.set(STORAGE_KEY, normalize({ theme: "moss" }));
  expect(h.settings.current().durable.theme).toBe("midnight");
  const write = h.storage.write.bind(h.storage);
  const gate = deferred<undefined>();
  let collectionWritten = false;
  const submittedSelections: string[] = [];
  h.storage.write = async (key, value) => {
    if (key === STORAGE_KEY) submittedSelections.push(normalize(value).theme);
    await write(key, value);
    if (key === CUSTOM_THEMES_KEY) {
      collectionWritten = true;
      await gate.promise;
    }
  };
  const undoing = h.themes.undo();
  await waitUntil(() => collectionWritten);
  const draft = h.settings.stage({ theme: "moss" });
  expect(h.settings.current().settings.theme).toBe("moss");
  draft.cancel();
  expect(h.settings.current().settings.theme).toBe("midnight");
  expect(h.settings.current().durable.theme).toBe("midnight");
  gate.resolve(undefined);
  await undoing;
  expect(submittedSelections).toEqual(["moss"]);
  expect(normalize(h.values.get(STORAGE_KEY)).theme).toBe("moss");
  expect(h.settings.current().durable.theme).toBe("moss");
  expect(h.settings.current().settings.theme).toBe("moss");
  expect(h.themes.current()).toEqual([two, one]);
  expect(h.values.get(CUSTOM_THEMES_KEY)).toEqual([two, one]);
  h.dispose();
});

test("cross-tab removed edit rejects without resurrection; fresh collection is merged", async () => {
  const h = fixture();
  await h.ready;
  h.external(CUSTOM_THEMES_KEY, [two]);
  await expectRejected(h.themes.save(one, one.id), "removed in another tab");
  expect(h.themes.current()).toEqual([two]);
  await h.themes.save({ ...one, id: "custom:new" }, null);
  expect(h.themes.current()).toEqual([two, { ...one, id: "custom:new" }]);
  h.dispose();
});

for (const committed of [true, false])
  test(`settings write rejection ${committed ? "reconciles committed readback" : "rolls collection back"}`, async () => {
    const h = fixture(one.id);
    await h.ready;
    const write = h.storage.write.bind(h.storage);
    h.storage.write = async (key, value) => {
      if (key === STORAGE_KEY) {
        if (committed) await write(key, value);
        throw new Error("settings denied");
      }
      await write(key, value);
    };
    if (committed) {
      await h.themes.remove(one.id);
      expect(h.themes.current()).toEqual([two]);
      expect(h.settings.current().durable.theme).toBe("midnight");
    } else {
      await expectRejected(h.themes.remove(one.id), "settings denied");
      expect(h.themes.current()).toEqual([one, two]);
      expect(h.values.get(CUSTOM_THEMES_KEY)).toEqual([one, two]);
      expect(h.settings.current().durable.theme).toBe(one.id);
    }
    h.dispose();
  });

test("collection write failure leaves state intact and disposal removes both subscriptions", async () => {
  const h = fixture();
  await h.ready;
  h.storage.write = () => Promise.reject(new Error("quota denied"));
  await expectRejected(
    h.themes.save({ ...one, name: "Failed" }, one.id),
    "quota denied",
  );
  expect(h.themes.current()).toEqual([one, two]);
  const subscriptions = h.listeners.get(STORAGE_KEY)?.size;
  expect(subscriptions).toBe(1);
  // The theme epoch observer is a settings-session listener, not a storage listener.
  h.themes.dispose();
  expect(h.listeners.get(CUSTOM_THEMES_KEY)?.size).toBe(0);
  // Settings stays usable, but cannot notify disposed theme subscribers.
  let notifications = 0;
  const stop = h.themes.subscribe(() => {
    notifications++;
  });
  h.external(STORAGE_KEY, normalize({ theme: "moss" }));
  h.external(CUSTOM_THEMES_KEY, []);
  expect(notifications).toBe(1);
  expect(h.themes.current()).toEqual([one, two]);
  await expectRejected(h.themes.save(one, one.id), "disposed");
  stop();
  h.dispose();
  expect([...h.listeners.values()].every((set) => set.size === 0)).toBe(true);
});
