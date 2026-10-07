import type { LocalImageThumbnail } from "../../services/local-image-thumbnail";

/** The native owner emits null before revoke; detach synchronously, not in a rune effect. */
export function connectThumbnail(
  thumbnail: Pick<LocalImageThumbnail, "subscribe">,
  image: Pick<HTMLImageElement, "removeAttribute" | "setAttribute">,
): () => void {
  return thumbnail.subscribe((url) => {
    if (url === null) image.removeAttribute("src");
    else image.setAttribute("src", url);
  });
}
