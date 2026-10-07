import {
  SETTINGS_WRITE_LOCK_NAME,
  type ExclusiveRunner,
  type SettingsPatchStore,
} from "../../domain/settings/schema";
import { createQueuedExclusiveRunner } from "../../services/settings-transactions";
import { IMAGE_LOCK_REASON } from "../../shared/local-image";
import type { ImageSettingsLock } from "../../services/local-image-workflow";
export interface SettingsLock {
  run: ExclusiveRunner;
  images: ImageSettingsLock;
  imageMutationsAvailable: boolean;
}
export function createSettingsLock(
  store: SettingsPatchStore,
  locks?: Pick<LockManager, "request">,
): SettingsLock {
  const run: ExclusiveRunner = locks
    ? async (work) =>
        await locks.request(
          SETTINGS_WRITE_LOCK_NAME,
          { mode: "exclusive" },
          work,
        )
    : createQueuedExclusiveRunner();
  return {
    run,
    imageMutationsAvailable: !!locks,
    images: (work) =>
      locks
        ? run(() => work(store))
        : Promise.reject(new Error(IMAGE_LOCK_REASON)),
  };
}
