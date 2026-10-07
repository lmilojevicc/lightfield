function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
import {
  mergeSettingsPatch,
  strictImageSettings,
  type Settings,
  type SettingsPatch,
  type SettingsPatchStore,
  type SettingsWriteObserver,
} from "../domain/settings/schema";
import {
  isLocalImageAssetId,
  IMAGE_CONFLICT,
  type LocalImageAssetId,
} from "../shared/local-image";
import type { LocalImageAssetStore } from "../platform/images/local-image-store";
import type {
  prepareLocalImage,
  PreparedLocalImage,
} from "../platform/images/local-image-loading";
export interface ImageIntent {
  revision: number;
  assetId: LocalImageAssetId | null;
}
export type ImageSettingsLock = <T>(
  work: (store: SettingsPatchStore) => Promise<T>,
) => Promise<T>;
function assertImageIntent(settings: Settings, expected: ImageIntent): void {
  if (
    settings.backgroundRevision !== expected.revision ||
    settings.localImage.assetId !== expected.assetId
  )
    throw new Error(IMAGE_CONFLICT);
}
export class LocalImageWorkflow {
  constructor(
    private readonly assets: LocalImageAssetStore,
    private readonly lock: ImageSettingsLock,
    private readonly prepare: typeof prepareLocalImage,
    private readonly identity: { randomUUID(): string; now(): number },
    private readonly publishing?: (settings: Settings) => void,
    private readonly cleanupPending?: () => void,
    private readonly writes?: Pick<
      SettingsWriteObserver,
      "prepared" | "acknowledged" | "failed"
    >,
  ) {}
  async import(
    blob: Blob,
    expected: ImageIntent,
    fit: "cover" | "contain",
    signal: AbortSignal,
  ): Promise<{ settings: Settings; prepared: PreparedLocalImage }> {
    const prepared = await this.prepare(blob, fit, signal);
    const abort = () => {
      prepared.dispose();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (isAborted(signal)) abort();
    try {
      const id = this.identity.randomUUID();
      if (!isLocalImageAssetId(id))
        throw new Error("Secure image ID generation unavailable.");
      const settings = await this.lock(async (store) => {
        const latest = strictImageSettings(await store.read());
        assertImageIntent(latest, expected);
        if (isAborted(signal)) throw new Error(IMAGE_CONFLICT);
        await this.assets.put({
          id,
          original: blob.slice(0, blob.size, prepared.metadata.mime),
          ...prepared.metadata,
          createdAt: this.identity.now(),
          formatVersion: 1,
        });
        // Candidate records are deliberately retained on uncertain outcomes. No destructive guess.
        const next = mergeSettingsPatch(latest, {
          background: "local-image",
          localImage: { ...latest.localImage, assetId: id, filter: "none" },
        });
        if (isAborted(signal)) throw new Error(IMAGE_CONFLICT);
        await this.writeConfirmed(store, latest, next);
        await this.deleteUnreferenced(store, expected.assetId);
        return next;
      });
      return { settings, prepared };
    } catch (error) {
      prepared.dispose();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async change(
    expected: ImageIntent,
    operation: "use" | "remove" | "cover" | "contain",
    signal?: AbortSignal,
  ): Promise<Settings> {
    // Verify saved bytes before selecting them, leaving the prior source intact on failure.
    if (operation === "use") {
      if (!expected.assetId) throw new Error("Add an image first.");
      const asset = await this.assets.get(expected.assetId);
      if (!asset)
        throw new Error(
          "Saved image unavailable. Retry, replace or remove it.",
        );
      const prepared = await this.prepare(asset.original, "cover", signal);
      prepared.dispose();
    }
    return this.lock(async (store) => {
      const latest = strictImageSettings(await store.read());
      assertImageIntent(latest, expected);
      if (signal && isAborted(signal)) throw new Error(IMAGE_CONFLICT);
      let patch: SettingsPatch;
      if (operation === "remove")
        patch = {
          localImage: { ...latest.localImage, assetId: null, filter: "none" },
          ...(latest.background === "local-image"
            ? { background: "none" as const }
            : {}),
        };
      else if (operation === "use")
        patch =
          latest.background === "local-image"
            ? {}
            : {
                background: "local-image",
                localImage: { ...latest.localImage, filter: "none" },
              };
      else patch = { localImage: { ...latest.localImage, fit: operation } };
      const next = mergeSettingsPatch(latest, patch);
      await this.writeConfirmed(store, latest, next);
      if (operation === "remove")
        await this.deleteUnreferenced(store, expected.assetId);
      return next;
    });
  }
  private async writeConfirmed(
    store: SettingsPatchStore,
    current: Settings,
    next: Settings,
  ): Promise<void> {
    this.writes?.prepared(current, next);
    this.publishing?.(next);
    try {
      await store.write(next);
      this.writes?.acknowledged(next);
    } catch {
      let raw: unknown;
      try {
        raw = await store.read();
      } catch {
        this.writes?.failed(next);
        throw new Error(
          "Couldn’t confirm the save. Checking saved background… Retry after reopening Settings.",
        );
      }
      const durable = strictImageSettings(raw);
      if (
        durable.backgroundRevision === next.backgroundRevision &&
        durable.background === next.background &&
        JSON.stringify(durable.localImage) === JSON.stringify(next.localImage)
      ) {
        this.writes?.acknowledged(next);
        return;
      }
      this.writes?.failed(next);
      throw new Error(
        "Couldn’t save this image; your previous background is unchanged.",
      );
    }
  }
  private async deleteUnreferenced(
    store: SettingsPatchStore,
    id: LocalImageAssetId | null,
  ): Promise<void> {
    if (!id) return;
    try {
      const latest = strictImageSettings(await store.read());
      if (latest.localImage.assetId !== id) await this.assets.delete(id);
    } catch {
      this.cleanupPending?.(); /* Retain rather than risk referenced/unsupported data. */
    }
  }
}
