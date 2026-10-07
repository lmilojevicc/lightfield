import { test, expect } from "bun:test";
import { connectThumbnail } from "../../../src/ui/backgrounds/thumbnail-view";
import { LocalImageThumbnail } from "../../../src/services/local-image-thumbnail";
import type { LocalImageAssetStore } from "../../../src/platform/images/local-image-store";
import type { LocalImageAssetId } from "../../../src/shared/local-image";

const assetId = "550e8400-e29b-41d4-a716-446655440000" as LocalImageAssetId;
test("real thumbnail clear detaches DOM src before revoking its tiny URL", async () => {
  const order: string[] = [];
  let src: string | null = null;
  function readSrc(): string | null {
    return src;
  }
  const thumbnail = new LocalImageThumbnail({} as LocalImageAssetStore, {
    hidden: () => false,
    createURL: () => "blob:tiny",
    revokeURL: (url) => {
      expect(readSrc()).toBeNull();
      order.push(`revoke ${url}`);
    },
    prepare: () => {
      throw new Error("active thumbnail must borrow, not decode");
    },
    thumbnail: () => {
      throw new Error("active thumbnail must borrow, not decode");
    },
  });
  const stop = connectThumbnail(thumbnail, {
    removeAttribute: () => {
      src = null;
      order.push("detach");
    },
    setAttribute: (_, url) => {
      src = url;
      order.push("attach");
    },
  });
  thumbnail.sync(assetId, true, true, Promise.resolve(new Blob(["tiny"])));
  await Promise.resolve();
  expect(readSrc()).toBe("blob:tiny");
  thumbnail.clear();
  expect(order.slice(-2)).toEqual(["detach", "revoke blob:tiny"]);
  thumbnail.dispose();
  stop();
});
test("late borrowed thumbnail is not attached after the view becomes hidden", async () => {
  let finish!: (value: Blob) => void;
  let attached = 0;
  const thumbnail = new LocalImageThumbnail({} as LocalImageAssetStore, {
    hidden: () => false,
    createURL: () => {
      attached++;
      return "blob:late";
    },
    revokeURL: () => {},
    prepare: () => {
      throw new Error("unexpected decode");
    },
    thumbnail: () => {
      throw new Error("unexpected decode");
    },
  });
  thumbnail.sync(
    assetId,
    true,
    true,
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  thumbnail.sync(assetId, true, false);
  finish(new Blob(["tiny"]));
  await Promise.resolve();
  expect(attached).toBe(0);
  expect(thumbnail.current()).toBeNull();
  thumbnail.dispose();
});
