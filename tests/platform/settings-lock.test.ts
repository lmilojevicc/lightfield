import { expect, test } from "bun:test";
import { createSettingsLock } from "../../src/platform/storage/settings-lock";
import {
  normalize,
  SETTINGS_WRITE_LOCK_NAME,
} from "../../src/domain/settings/schema";
import {
  createQueuedExclusiveRunner,
  mergeWriteSettingsPatch,
} from "../../src/services/settings-transactions";
import { expectRejected } from "./rejection";
test("separate document runners share the actual named Web Lock and merge latest fields", async () => {
  const queue = createQueuedExclusiveRunner();
  const names: string[] = [];
  const locks = {
    request: (
      name: string,
      options: LockOptions,
      work: () => Promise<unknown>,
    ) => {
      names.push(name);
      expect(options.mode).toBe("exclusive");
      return queue(work);
    },
  } as unknown as Pick<LockManager, "request">;
  let durable = normalize(null);
  const store = {
    read: () => Promise.resolve(durable),
    write: (next: typeof durable) => {
      durable = next;
      return Promise.resolve();
    },
  };
  const a = createSettingsLock(store, locks),
    b = createSettingsLock(store, locks);
  await Promise.all([
    mergeWriteSettingsPatch(store, { theme: "moss" }, a.run),
    mergeWriteSettingsPatch(store, { glassBlur: 40 }, b.run),
  ]);
  expect(durable).toMatchObject({ theme: "moss", glassBlur: 40 });
  expect(names).toEqual([SETTINGS_WRITE_LOCK_NAME, SETTINGS_WRITE_LOCK_NAME]);
  expect(a.imageMutationsAvailable).toBe(true);
  expect(await a.images(async (saved) => await saved.read())).toEqual(durable);
});
test("no lock or rejected acquisition never permits destructive image mutations", async () => {
  let reads = 0;
  const store = {
    read: () => {
      reads++;
      return Promise.resolve(undefined);
    },
    write: () => Promise.resolve(),
  };
  const unavailable = createSettingsLock(store);
  expect(unavailable.imageMutationsAvailable).toBe(false);
  await expectRejected(
    unavailable.images(async (saved) => await saved.read()),
    "Web Locks",
  );
  expect(reads).toBe(0);
  const locks = {
    request: () => Promise.reject(new Error("lock denied")),
  } as unknown as Pick<LockManager, "request">;
  const blocked = createSettingsLock(store, locks);
  await expectRejected(
    blocked.images(async (saved) => await saved.read()),
    "lock denied",
  );
  expect(reads).toBe(0);
});
