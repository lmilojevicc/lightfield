import {
  mergeSettingsPatch,
  normalize,
  storedSettingsNeedNormalization,
  type ExclusiveRunner,
  type Settings,
  type SettingsPatch,
  type SettingsPatchStore,
  type SettingsWriteObserver,
} from "../domain/settings/schema";
export function createQueuedExclusiveRunner(): ExclusiveRunner {
  let queue = Promise.resolve();
  return <T>(work: () => Promise<T>) => {
    const task = queue.then(work, work);
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
}

export function mergeWriteSettingsPatch(
  store: SettingsPatchStore,
  patch: SettingsPatch,
  runExclusive: ExclusiveRunner,
  observer?: SettingsWriteObserver,
  beforeWrite?: () => void,
): Promise<Settings> {
  return runExclusive(async () => {
    const current = await store.read();
    const merged = mergeSettingsPatch(
      current,
      observer ? observer.patch(patch) : patch,
    );
    beforeWrite?.();
    observer?.prepared(normalize(current), merged);
    try {
      await store.write(merged);
    } catch (error) {
      observer?.failed(merged);
      throw error;
    }
    observer?.acknowledged(merged);
    return merged;
  });
}

export function normalizeSettingsStore(
  store: SettingsPatchStore,
  runExclusive: ExclusiveRunner,
): Promise<Settings> {
  return runExclusive(async () => {
    const raw = await store.read();
    const normalized = normalize(raw);
    if (storedSettingsNeedNormalization(raw)) await store.write(normalized);
    return normalized;
  });
}
