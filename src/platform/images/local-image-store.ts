import {
  isLocalImageAssetId,
  type LocalImageAssetId,
} from "../../shared/local-image";
import type { LocalImageMetadata } from "../../domain/images/local-image-validation";
export const LOCAL_IMAGE_DATABASE = "lightfield:local-images";
const LOCAL_IMAGE_STORE_CAP = 96 * 1024 * 1024;
export interface LocalImageAsset extends LocalImageMetadata {
  id: LocalImageAssetId;
  original: Blob;
  createdAt: number;
  formatVersion: 1;
}
export interface LocalImageAssetStore {
  get(id: LocalImageAssetId): Promise<LocalImageAsset | undefined>;
  put(asset: LocalImageAsset): Promise<void>;
  delete(id: LocalImageAssetId): Promise<void>;
}
function openDatabase(
  indexedDB: Pick<IDBFactory, "open">,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_IMAGE_DATABASE, 1);
    let failed = false;
    request.onupgradeneeded = () =>
      request.result.createObjectStore("assets", { keyPath: "id" });
    request.onerror = () => {
      reject(request.error ?? new Error("Local image storage is unavailable."));
    };
    request.onblocked = () => {
      failed = true;
      reject(
        new Error(
          "Local image storage is blocked. Close older tabs and retry.",
        ),
      );
    };
    request.onsuccess = () => {
      const db = request.result;
      if (failed) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };
  });
}
/** Resolve only on transaction complete, never on a successful individual request. */
export async function imageTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, result: (value: T) => void) => void,
  indexedDB: Pick<IDBFactory, "open">,
): Promise<T> {
  const db = await openDatabase(indexedDB);
  return new Promise<T>((resolve, reject) => {
    let value: T;
    const transaction = db.transaction("assets", mode);
    transaction.oncomplete = () => {
      db.close();
      resolve(value);
    };
    transaction.onabort = () => {
      db.close();
      reject(
        new Error(
          mode === "readwrite"
            ? "Couldn’t store this image (local quota, 96 MiB storage cap or aborted transaction). Your previous image is unchanged."
            : "Couldn’t read the saved image.",
        ),
      );
    };
    transaction.onerror = () => {}; // onabort is authoritative
    try {
      work(transaction.objectStore("assets"), (next) => {
        value = next;
      });
    } catch (error) {
      transaction.abort();
      db.close();
      reject(
        error instanceof Error
          ? error
          : new Error("Local image transaction failed."),
      );
    }
  });
}
export function createLocalImageAssetStore(
  indexedDB: Pick<IDBFactory, "open">,
): LocalImageAssetStore {
  const transaction = <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore, result: (value: T) => void) => void,
  ) => imageTransaction(mode, work, indexedDB);
  return {
    get: (id) =>
      transaction("readonly", (store, result) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const asset: unknown = request.result;
          if (asset !== undefined && !validAsset(asset, id)) {
            store.transaction.abort();
            return;
          }
          result(
            asset === undefined
              ? undefined
              : validAsset(asset, id)
                ? asset
                : undefined,
          );
        };
      }),
    put: (asset) =>
      transaction<undefined>("readwrite", (store, result) => {
        // Count without getAll: only one original is cloned at a time, no 96 MiB array.
        let total = asset.bytes;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (entry) {
            const candidate: unknown = entry.value;
            const bytes =
              candidate && typeof candidate === "object" && "bytes" in candidate
                ? candidate.bytes
                : undefined;
            if (
              typeof bytes !== "number" ||
              !Number.isSafeInteger(bytes) ||
              bytes < 0
            ) {
              store.transaction.abort();
              return;
            }
            total += bytes;
            if (total > LOCAL_IMAGE_STORE_CAP) {
              store.transaction.abort();
              return;
            }
            entry.continue();
          } else {
            if (total > LOCAL_IMAGE_STORE_CAP) {
              store.transaction.abort();
              return;
            }
            try {
              store.add(asset);
              result(undefined);
            } catch {
              store.transaction.abort();
            }
          }
        };
      }),
    delete: (id) =>
      transaction<undefined>("readwrite", (store, result) => {
        store.delete(id);
        result(undefined);
      }),
  };
}

function validAsset(
  value: unknown,
  id: LocalImageAssetId,
): value is LocalImageAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Record<string, unknown>;
  return (
    isLocalImageAssetId(asset.id) &&
    asset.id === id &&
    asset.formatVersion === 1 &&
    asset.original instanceof Blob &&
    asset.bytes === asset.original.size &&
    typeof asset.width === "number" &&
    Number.isSafeInteger(asset.width) &&
    asset.width > 0 &&
    typeof asset.height === "number" &&
    Number.isSafeInteger(asset.height) &&
    asset.height > 0 &&
    typeof asset.createdAt === "number" &&
    Number.isFinite(asset.createdAt) &&
    typeof asset.orientation === "number" &&
    Number.isInteger(asset.orientation) &&
    asset.orientation >= 1 &&
    asset.orientation <= 8 &&
    ["image/jpeg", "image/png", "image/webp"].includes(String(asset.mime))
  );
}
