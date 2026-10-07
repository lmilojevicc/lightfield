import type { LocalImageAssetId } from "../shared/local-image";
import type { LocalImageAssetStore } from "../platform/images/local-image-store";
import type { PreparedLocalImage } from "../platform/images/local-image-loading";
export interface ThumbnailEnvironment {
  hidden(): boolean;
  createURL(blob: Blob): string;
  revokeURL(url: string): void;
  prepare(blob: Blob, signal: AbortSignal): Promise<PreparedLocalImage>;
  thumbnail(prepared: PreparedLocalImage): Promise<Blob>;
}
/** UI owns only this tiny URL. Borrowed background pixels cross ownership only as a Blob. */
export class LocalImageThumbnail {
  private key = "";
  private url: string | null = null;
  private request: AbortController | null = null;
  private listeners = new Set<(url: string | null) => void>();
  constructor(
    private readonly assets: LocalImageAssetStore,
    private readonly env: ThumbnailEnvironment,
  ) {}
  current(): string | null {
    return this.url;
  }
  subscribe(listener: (url: string | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.url);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(): void {
    for (const listener of this.listeners) listener(this.url);
  }
  clear(): void {
    this.request?.abort();
    this.request = null;
    this.key = "";
    const previous = this.url;
    this.url = null;
    this.emit();
    if (previous) this.env.revokeURL(previous);
  }
  sync(
    assetId: LocalImageAssetId | null,
    active: boolean,
    visible: boolean,
    borrowed?: Promise<Blob>,
  ): void {
    if (!assetId || !visible) {
      this.clear();
      return;
    }
    const key = `${assetId}/${String(active)}`;
    if (key === this.key) return;
    this.clear();
    if (active && !borrowed) return;
    this.key = key;
    const request = new AbortController();
    this.request = request;
    void (async () => {
      let blob: Blob;
      if (borrowed) blob = await borrowed;
      else {
        const asset = await this.assets.get(assetId);
        if (!asset || request.signal.aborted || this.env.hidden()) return;
        const prepared = await this.env.prepare(asset.original, request.signal);
        try {
          blob = await this.env.thumbnail(prepared);
        } finally {
          prepared.dispose();
        }
      }
      if (request.signal.aborted || this.env.hidden() || this.key !== key)
        return;
      this.url = this.env.createURL(blob);
      this.emit();
    })().catch(() => {
      /* A thumbnail failure never fails the actual background. */
    });
  }
  dispose(): void {
    this.clear();
    this.listeners.clear();
  }
}
