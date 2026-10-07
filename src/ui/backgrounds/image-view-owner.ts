import type { PreparedLocalImage } from "../../platform/images/local-image-loading";
import type { AppServices, ImageSessionIntent } from "../../services/contracts";
import type { LocalImageAssetId } from "../../shared/local-image";

export type BorrowThumbnail = (
  assetId: LocalImageAssetId,
) => Promise<Blob> | undefined;

/** UI does not infer a committed asset receipt from a later settings snapshot. */
export class ImageViewOwner {
  private request: AbortController | null = null;
  constructor(private services: AppServices) {}
  cancel() {
    this.request?.abort();
    this.request = null;
  }
  async import(file: Blob, expected: ImageSessionIntent) {
    this.cancel();
    const request = (this.request = new AbortController());
    let prepared: PreparedLocalImage | undefined;
    try {
      prepared = await this.services.images.import(
        file,
        expected,
        "cover",
        request.signal,
      );
    } finally {
      prepared?.dispose();
      if (this.request === request) this.request = null;
    }
  }
  async change(
    operation: "use" | "remove" | "cover" | "contain",
    expected: ImageSessionIntent,
  ) {
    this.cancel();
    const request = (this.request = new AbortController());
    try {
      return await this.services.images.change(
        operation,
        expected,
        request.signal,
      );
    } finally {
      if (this.request === request) this.request = null;
    }
  }
}
