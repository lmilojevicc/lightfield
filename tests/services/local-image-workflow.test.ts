import { expectRejected } from "../platform/rejection";
import { requiredValue } from "../../src/domain/required-value";
import { test, expect } from "bun:test";
import {
  DEFAULT_SETTINGS,
  mergeSettingsPatch,
  type Settings,
  type SettingsPatchStore,
} from "../../src/domain/settings/schema";
import { createQueuedExclusiveRunner } from "../../src/services/settings-transactions";
import {
  LocalImageWorkflow,
  type ImageIntent,
} from "../../src/services/local-image-workflow";
import type {
  LocalImageAssetStore,
  LocalImageAsset,
} from "../../src/platform/images/local-image-store";
import type { PreparedLocalImage } from "../../src/platform/images/local-image-loading";
import type { LocalImageAssetId } from "../../src/shared/local-image";
function fixture() {
  let durable: Settings = structuredClone(DEFAULT_SETTINGS),
    failWrite = false,
    uncertainRead = false,
    failPut = false,
    writeThenFail = false;
  let disposed = 0;
  const events: string[] = [],
    blobs = new Map<LocalImageAssetId, LocalImageAsset>();
  const store: SettingsPatchStore = {
    read: () => {
      return Promise.resolve().then(() => {
        if (uncertainRead) throw Error("read failed");
        return structuredClone(durable);
      });
    },
    write: (next) => {
      return Promise.resolve().then(() => {
        events.push("settings");
        if (writeThenFail) {
          durable = next;
          throw Error("ambiguous");
        }
        if (failWrite) throw Error("save failed");
        durable = structuredClone(next);
      });
    },
  };
  const assets: LocalImageAssetStore = {
    get: (id) => Promise.resolve(blobs.get(id)),
    put: (asset) => {
      return Promise.resolve().then(() => {
        events.push("put complete");
        if (failPut) throw Error("quota/abort");
        blobs.set(asset.id, asset);
      });
    },
    delete: (id) => {
      return Promise.resolve().then(() => {
        events.push("delete");
        blobs.delete(id);
      });
    },
  };
  const queue = createQueuedExclusiveRunner();
  const prepare = (): Promise<PreparedLocalImage> => {
    let done = false;
    return Promise.resolve({
      image: {} as HTMLImageElement,
      metadata: {
        mime: "image/png",
        width: 2,
        height: 2,
        bytes: 1,
        orientation: 1,
      },
      width: 2,
      height: 2,
      dispose() {
        if (!done) {
          done = true;
          disposed++;
        }
      },
    });
  };
  const workflow = new LocalImageWorkflow(
    assets,
    (work) => queue(() => work(store)),
    prepare,
    { randomUUID: () => crypto.randomUUID(), now: () => 1000 },
  );
  return {
    workflow,
    events,
    blobs,
    get durable() {
      return durable;
    },
    set durable(value) {
      durable = value;
    },
    get disposed() {
      return disposed;
    },
    failSave() {
      failWrite = true;
    },
    ambiguousSuccess() {
      writeThenFail = true;
    },
    quota() {
      failPut = true;
    },
    setReadFailure() {
      uncertainRead = true;
    },
  };
}
const signal = () => new AbortController().signal;
const intent = (settings: Settings): ImageIntent => ({
  revision: settings.backgroundRevision,
  assetId: settings.localImage.assetId,
});
const blob = new Blob(["x"], { type: "image/png" });
test("local-image-workflow decode -> IDB completion -> pointer -> retire old", async () => {
  const f = fixture();
  const first = await f.workflow.import(
    blob,
    intent(f.durable),
    "cover",
    signal(),
  );
  first.prepared.dispose();
  const old = f.durable.localImage.assetId;
  const next = await f.workflow.import(
    blob,
    intent(f.durable),
    "cover",
    signal(),
  );
  next.prepared.dispose();
  expect(f.events).toEqual([
    "put complete",
    "settings",
    "put complete",
    "settings",
    "delete",
  ]);
  expect(f.blobs.has(requiredValue(old))).toBe(false);
  expect(f.blobs.has(requiredValue(f.durable.localImage.assetId))).toBe(true);
});
test("local-image-workflow two-tab replacements reject stale intent; unrelated fields merge", async () => {
  const f = fixture(),
    expected = intent(f.durable);
  f.durable = mergeSettingsPatch(f.durable, { weatherLocation: "Other tab" });
  const results = await Promise.allSettled([
    f.workflow.import(blob, expected, "cover", signal()),
    f.workflow.import(blob, expected, "cover", signal()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.durable.weatherLocation).toBe("Other tab");
  expect(f.blobs.size).toBe(1);
  expect(f.disposed).toBe(1);
});
test("local-image-workflow stale delete cannot delete replacement", async () => {
  const f = fixture();
  (
    await f.workflow.import(blob, intent(f.durable), "cover", signal())
  ).prepared.dispose();
  const expected = intent(f.durable);
  (
    await f.workflow.import(blob, expected, "cover", signal())
  ).prepared.dispose();
  await expectRejected(f.workflow.change(expected, "remove"), "another tab");
  expect(f.blobs.has(requiredValue(f.durable.localImage.assetId))).toBe(true);
});
test("local-image-workflow inactive removal preserves procedural selection", async () => {
  const f = fixture();
  (
    await f.workflow.import(blob, intent(f.durable), "cover", signal())
  ).prepared.dispose();
  f.durable = mergeSettingsPatch(f.durable, { background: "ink" });
  await f.workflow.change(intent(f.durable), "remove");
  expect(f.durable.background).toBe("ink");
  expect(f.durable.localImage.assetId).toBe(null);
  expect(f.blobs.size).toBe(0);
});
test("local-image-workflow quota/transaction abort never writes a pointer", async () => {
  const f = fixture();
  f.quota();
  await expectRejected(
    f.workflow.import(blob, intent(f.durable), "cover", signal()),
  );
  expect(f.events).toEqual(["put complete"]);
  expect(f.durable.background).toBe(DEFAULT_SETTINGS.background);
  expect(f.disposed).toBe(1);
});
test("local-image-workflow confirmed save failure retains prior bytes and candidate orphan", async () => {
  const f = fixture();
  (
    await f.workflow.import(blob, intent(f.durable), "cover", signal())
  ).prepared.dispose();
  const old = f.durable.localImage.assetId;
  f.failSave();
  await expectRejected(
    f.workflow.import(blob, intent(f.durable), "cover", signal()),
    "previous background",
  );
  expect(f.durable.localImage.assetId).toBe(old);
  expect(f.blobs.has(requiredValue(old))).toBe(true);
  expect(f.blobs.size).toBe(2);
  await expectRejected(f.workflow.change(intent(f.durable), "remove"));
  expect(f.blobs.has(requiredValue(old))).toBe(true);
});
test("local-image-workflow ambiguous successful write reconciles without deleting current", async () => {
  const f = fixture();
  f.ambiguousSuccess();
  const result = await f.workflow.import(
    blob,
    intent(f.durable),
    "cover",
    signal(),
  );
  result.prepared.dispose();
  expect(f.durable.localImage.assetId).toBe(result.settings.localImage.assetId);
  expect(f.blobs.size).toBe(1);
});
test("local-image-workflow cancelled and missing source leave prior selection", async () => {
  const f = fixture(),
    abort = new AbortController();
  abort.abort();
  await expectRejected(
    f.workflow.import(blob, intent(f.durable), "cover", abort.signal),
  );
  expect(f.events).toEqual([]);
  await expectRejected(
    f.workflow.change(intent(f.durable), "use"),
    "Add an image",
  );
  expect(f.durable.background).toBe(DEFAULT_SETTINGS.background);
});
test("local-image-workflow never publishes before asynchronous put completion", async () => {
  let release!: () => void,
    inserted = false,
    writes = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store: SettingsPatchStore = {
    read: () => Promise.resolve(DEFAULT_SETTINGS),
    write: () => {
      return Promise.resolve().then(() => {
        expect(inserted).toBe(true);
        writes++;
      });
    },
  };
  const assets: LocalImageAssetStore = {
    get: () => Promise.resolve(undefined),
    put: async () => {
      await pending;
      inserted = true;
    },
    delete: async () => {},
  };
  const prepared = {
    metadata: {
      mime: "image/png",
      bytes: 1,
      width: 1,
      height: 1,
      orientation: 1,
    },
    dispose() {},
  } as PreparedLocalImage;
  const workflow = new LocalImageWorkflow(
    assets,
    (work) => work(store),
    () => Promise.resolve(prepared),
    { randomUUID: () => crypto.randomUUID(), now: () => 1000 },
  );
  const task = workflow.import(
    blob,
    intent(DEFAULT_SETTINGS),
    "cover",
    signal(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(writes).toBe(0);
  release();
  await task;
  expect(writes).toBe(1);
});
test("local-image-workflow uncertain write plus failed reread retains candidate", async () => {
  let reads = 0,
    deletes = 0,
    puts = 0,
    disposed = 0;
  const store: SettingsPatchStore = {
    read: () => {
      return Promise.resolve().then(() => {
        if (++reads > 1) throw Error("unavailable");
        return DEFAULT_SETTINGS;
      });
    },
    write: () => {
      return Promise.resolve().then(() => {
        throw Error("uncertain");
      });
    },
  };
  const assets: LocalImageAssetStore = {
    get: () => Promise.resolve(undefined),
    put: () => {
      return Promise.resolve().then(() => {
        puts++;
      });
    },
    delete: () => {
      return Promise.resolve().then(() => {
        deletes++;
      });
    },
  };
  const prepared = {
    metadata: {
      mime: "image/png",
      bytes: 1,
      width: 1,
      height: 1,
      orientation: 1,
    },
    dispose() {
      disposed++;
    },
  } as PreparedLocalImage;
  const workflow = new LocalImageWorkflow(
    assets,
    (work) => work(store),
    () => Promise.resolve(prepared),
    { randomUUID: () => crypto.randomUUID(), now: () => 1000 },
  );
  await expectRejected(
    workflow.import(blob, intent(DEFAULT_SETTINGS), "cover", signal()),
    "confirm",
  );
  expect(puts).toBe(1);
  expect(deletes).toBe(0);
  expect(disposed).toBe(1);
});
test("abort while awaiting the settings lock immediately releases the verified derivative, never a pointer", async () => {
  let disposed = 0,
    done = false,
    puts = 0,
    enter: (() => void) | undefined;
  const prepared: PreparedLocalImage = {
    image: {} as HTMLImageElement,
    metadata: {
      mime: "image/png",
      width: 1,
      height: 1,
      bytes: 1,
      orientation: 1,
    },
    width: 1,
    height: 1,
    dispose: () => {
      if (!done) {
        done = true;
        disposed++;
      }
    },
  };
  const store: SettingsPatchStore = {
    read: () => Promise.resolve(DEFAULT_SETTINGS),
    write: () => {
      throw new Error("No cancelled pointer write");
    },
  };
  const workflow = new LocalImageWorkflow(
    {
      get: () => Promise.resolve(undefined),
      put: () => {
        puts++;
        return Promise.resolve();
      },
      delete: () => Promise.resolve(),
    },
    (work) =>
      new Promise((resolve, reject) => {
        enter = () => {
          void work(store).then(resolve, reject);
        };
      }),
    () => Promise.resolve(prepared),
    { randomUUID: () => crypto.randomUUID(), now: () => 0 },
  );
  const abort = new AbortController();
  const importing = workflow.import(
    blob,
    intent(DEFAULT_SETTINGS),
    "cover",
    abort.signal,
  );
  await Promise.resolve();
  abort.abort();
  expect(disposed).toBe(1);
  if (!enter) throw new Error("Missing pending lock");
  enter();
  await expectRejected(importing, "another tab");
  expect(puts).toBe(0);
  expect(disposed).toBe(1);
});
