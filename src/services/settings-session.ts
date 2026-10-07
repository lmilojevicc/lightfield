import {
  BackgroundOwnership,
  type BackgroundIntent,
  reconcileBackgroundPublication,
} from "../domain/settings/background-ownership";
import {
  createPatchOwnership,
  ownPatch,
  setOwnedPatchPhase,
  settleOwnedPatch,
  persistenceStatusSnapshot,
  failedOwnedPatch,
  canClearSavedStatus,
  normalize,
  STORAGE_KEY,
  type Settings,
  type SettingsPatch,
  type SettingsPatchStore,
  type ExclusiveRunner,
  type OwnedPatchAttempt,
  type SettingsWriteObserver,
} from "../domain/settings/schema";
import {
  normalizeSettingsStore,
  mergeWriteSettingsPatch,
} from "./settings-transactions";
import {
  hasBackgroundPatch,
  unsupportedLocalImage,
} from "../shared/local-image";
import type { StorageAdapter } from "../platform/storage/browser-storage";
import type {
  SettingsDraft,
  SettingsSession,
  SettingsSnapshot,
} from "./contracts";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Could not save settings.";
export class NativeSettingsSession implements SettingsSession {
  private durable = normalize(null);
  private ownership = createPatchOwnership<Settings>();
  readonly background = new BackgroundOwnership(this.durable);
  private listeners = new Set<(snapshot: SettingsSnapshot) => void>();
  private error: string | null = null;
  private succeeded = false;
  private ready = false;
  private disposed = false;
  private unknownImage = false;
  private generation = 0;
  private drafts = new Map<OwnedPatchAttempt<Settings>, SettingsDraft>();
  private unsubscribe: () => void;
  readonly store: SettingsPatchStore;
  constructor(
    storage: StorageAdapter,
    private readonly exclusive: ExclusiveRunner,
    private readonly imageAvailable: boolean,
  ) {
    this.store = {
      read: () => storage.read(STORAGE_KEY),
      write: (settings) => storage.write(STORAGE_KEY, settings),
    };
    this.unsubscribe = storage.subscribe(STORAGE_KEY, (raw) => {
      this.acceptRaw(raw);
    });
  }
  current(): SettingsSnapshot {
    const settings = reconcileBackgroundPublication(
      this.durable,
      this.background,
      this.ownership,
    ).incoming;
    return structuredClone({
      settings,
      durable: this.durable,
      persistenceRevision: this.ownership.nextRevision,
      persistence: persistenceStatusSnapshot(this.ownership, this.succeeded),
      error: this.error,
      ready: this.ready,
      unsupportedImage: this.unknownImage,
      imageMutationsAvailable: this.imageAvailable && !this.unknownImage,
    });
  }
  subscribe(listener: (snapshot: SettingsSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(): void {
    if (!this.disposed)
      for (const listener of this.listeners) listener(this.current());
  }
  private acceptRaw(raw: unknown): void {
    if (this.disposed) return;
    this.generation++;
    const incoming = normalize(raw);
    const observation = reconcileBackgroundPublication(
      incoming,
      this.background,
      this.ownership,
    );
    if (observation.observation === "stale") return;
    this.unknownImage = unsupportedLocalImage(
      raw && typeof raw === "object" && "localImage" in raw
        ? raw.localImage
        : undefined,
    );
    this.durable = incoming;
    if (observation.observation === "external") {
      for (const [attempt, draft] of [...this.drafts])
        if (hasBackgroundPatch(attempt.patch)) {
          for (const key of [
            "background",
            "backgroundOverrides",
            "backgroundRevision",
            "localImage",
          ] as const) {
            Reflect.deleteProperty(attempt.patch, key);
            Reflect.deleteProperty(attempt.revisions, key);
          }
          if (Object.keys(attempt.patch).length === 0) {
            try {
              draft.cancel();
            } catch {
              this.drafts.delete(attempt);
            }
          }
        }
    }
    this.emit();
  }
  publish(next: Settings): void {
    this.acceptRaw(next);
  }
  async reload(): Promise<void> {
    if (this.disposed) throw new Error("Settings session disposed.");
    const generation = this.generation;
    try {
      await normalizeSettingsStore(this.store, this.exclusive);
      const raw = await this.store.read();
      if (generation === this.generation) this.acceptRaw(raw);
      this.ready = true;
      this.error = null;
    } catch (error) {
      this.ready = true;
      this.error = message(error);
      throw error;
    } finally {
      this.emit();
    }
  }
  private editable(patch: SettingsPatch): void {
    if (this.disposed) throw new Error("Settings session disposed.");
    if (
      patch.fonts !== undefined ||
      patch.customDisplayFont !== undefined ||
      patch.customBodyFont !== undefined
    )
      throw new Error(
        "Use fonts.save or fonts.preset to commit verified font tuples.",
      );
    if (
      patch.localImage &&
      (patch.backgroundRevision === undefined || patch.background !== undefined)
    )
      throw new Error(
        "Use images.import or images.change for source, reference and fit transactions.",
      );
    if (hasBackgroundPatch(patch) && this.unknownImage)
      throw new Error(
        "This saved image schema is unsupported. Background editing is unavailable.",
      );
  }
  stage(patch: SettingsPatch): SettingsDraft {
    this.editable(patch);
    patch = structuredClone(patch);
    const attempt = ownPatch(this.ownership, patch, "dirty");
    const intent = this.background.intent(
      patch.backgroundRevision ?? this.durable.backgroundRevision,
    );
    let work: Promise<Settings> | undefined;
    let cancelled = false;
    const draft: SettingsDraft = {
      commit: () => {
        if (cancelled)
          return Promise.reject(new Error("Settings draft cancelled."));
        work ??= this.write(patch, true, attempt, intent).finally(() => {
          this.drafts.delete(attempt);
        });
        return work;
      },
      cancel: () => {
        if (work)
          throw new Error(
            "Submitted settings cannot be cancelled. Retry or submit another patch.",
          );
        cancelled = true;
        settleOwnedPatch(this.ownership, attempt, true);
        this.drafts.delete(attempt);
        this.emit();
      },
    };
    this.drafts.set(attempt, draft);
    this.succeeded = false;
    this.error = null;
    this.emit();
    return draft;
  }
  async patch(patch: SettingsPatch): Promise<Settings> {
    this.editable(patch);
    return this.write(patch, true);
  }
  async write(
    patch: SettingsPatch,
    optimistic: boolean,
    staged?: OwnedPatchAttempt<Settings>,
    capturedIntent?: BackgroundIntent,
    beforeWrite?: () => void,
  ): Promise<Settings> {
    if (this.disposed) throw new Error("Settings session disposed.");
    patch = structuredClone(patch);
    const attempt =
      staged ?? ownPatch(this.ownership, optimistic ? patch : {}, "queued");
    setOwnedPatchPhase(this.ownership, attempt, "queued");
    const intent =
      capturedIntent ??
      this.background.intent(
        patch.backgroundRevision ?? this.durable.backgroundRevision,
      );
    this.succeeded = false;
    this.error = null;
    this.emit();
    try {
      setOwnedPatchPhase(this.ownership, attempt, "in-flight");
      this.emit();
      const backgroundObserver = this.background.observer(intent);
      let backgroundWrite = false;
      const observer: SettingsWriteObserver | undefined = staged
        ? {
            patch: () => {
              const current = staged.patch;
              if (Object.keys(current).length === 0)
                throw new Error("Settings draft cancelled.");
              backgroundWrite = hasBackgroundPatch(current);
              return backgroundWrite
                ? backgroundObserver.patch(current)
                : current;
            },
            prepared: (current, next) => {
              if (backgroundWrite) backgroundObserver.prepared(current, next);
            },
            acknowledged: (next) => {
              if (backgroundWrite) backgroundObserver.acknowledged(next);
            },
            failed: (next) => {
              if (backgroundWrite) backgroundObserver.failed(next);
            },
          }
        : hasBackgroundPatch(patch)
          ? backgroundObserver
          : undefined;
      const next = await mergeWriteSettingsPatch(
        this.store,
        patch,
        this.exclusive,
        observer,
        beforeWrite,
      );
      settleOwnedPatch(this.ownership, attempt, true);
      // Ordered external echoes after our write must win, including non-background font tuples.
      const generation = this.generation;
      const raw = await this.store.read();
      if (generation === this.generation) this.acceptRaw(raw);
      this.succeeded = true;
      this.error = null;
      this.emit();
      return next;
    } catch (error) {
      settleOwnedPatch(this.ownership, attempt, false);
      this.error = message(error);
      this.emit();
      throw error;
    }
  }
  async flushBackground(): Promise<void> {
    for (const [attempt, draft] of this.drafts)
      if (hasBackgroundPatch(attempt.patch)) await draft.commit();
    await this.exclusive(async () => {
      await this.store.read();
      const fields = this.ownership.fields;
      if (
        [
          fields.background,
          fields.backgroundOverrides,
          fields.backgroundRevision,
          fields.localImage,
        ].some((field) => field?.phase === "failed")
      )
        throw new Error(
          "Couldn’t save changes. Retry before changing the image.",
        );
    });
  }
  clearSavedStatus(revision: number): boolean {
    if (
      !canClearSavedStatus(
        revision,
        this.ownership.nextRevision,
        this.ownership,
        this.succeeded,
      )
    )
      return false;
    this.succeeded = false;
    this.emit();
    return true;
  }
  retry(): Promise<Settings> {
    return this.patch(failedOwnedPatch(this.ownership));
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.background.invalidate();
    this.unsubscribe();
    this.listeners.clear();
    this.drafts.clear();
  }
}
