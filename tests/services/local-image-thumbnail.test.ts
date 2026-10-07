import { expect, test } from "bun:test";
import { LocalImageThumbnail } from "../../src/services/local-image-thumbnail";
import { isLocalImageAssetId } from "../../src/shared/local-image";
test("tiny URL is independent, stale borrowed completion cannot publish, listeners detach before revocation", async () => {
  const id = "12345678-1234-4123-8123-123456789abc";
  if (!isLocalImageAssetId(id)) throw new Error("Bad fixture ID");
  let resolve: ((blob: Blob) => void) | undefined;
  const borrowed = new Promise<Blob>((done) => {
    resolve = done;
  });
  const events: string[] = [];
  const thumbnail = new LocalImageThumbnail(
    {
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    {
      hidden: () => false,
      createURL: () => "blob:tiny",
      revokeURL: (url) => {
        events.push(`revoke:${url}`);
      },
      prepare: () =>
        Promise.reject(new Error("No independent decode for active image")),
      thumbnail: () => Promise.resolve(new Blob()),
    },
  );
  thumbnail.subscribe((url) => {
    events.push(url ?? "clear");
  });
  thumbnail.sync(id, true, true, borrowed);
  thumbnail.clear();
  if (!resolve) throw new Error("Missing borrowed request");
  resolve(new Blob());
  await Promise.resolve();
  expect(thumbnail.current()).toBeNull();
  thumbnail.sync(id, true, true, Promise.resolve(new Blob()));
  await Promise.resolve();
  expect(thumbnail.current()).toBe("blob:tiny");
  thumbnail.clear();
  expect(events.slice(-2)).toEqual(["clear", "revoke:blob:tiny"]);
  thumbnail.dispose();
});
