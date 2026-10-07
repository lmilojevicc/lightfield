export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}
interface ExtensionStorage {
  local: {
    get(key: string): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  };
  onChanged: {
    addListener(
      listener: (changes: Record<string, StorageChange>, area: string) => void,
    ): void;
    removeListener(
      listener: (changes: Record<string, StorageChange>, area: string) => void,
    ): void;
  };
}
export interface BrowserNamespace {
  permissions?: import("../permissions").PermissionAPI;
  storage?: ExtensionStorage;
  windows?: {
    getCurrent(): Promise<{ id?: number; focused?: boolean }>;
    onFocusChanged: {
      addListener(listener: (id: number) => void): void;
      removeListener(listener: (id: number) => void): void;
    };
  };
}
export interface StorageAdapter {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
}
export interface StorageEnvironment {
  browser?: BrowserNamespace;
  chrome?: BrowserNamespace;
  localStorage?: Pick<Storage, "getItem" | "setItem">;
  events?: Pick<Window, "addEventListener" | "removeEventListener">;
}
/** Modern Chromium and Firefox both expose Promise storage. Use one namespace, never duplicate writes. */
export function createBrowserStorage(env: StorageEnvironment): StorageAdapter {
  const storage = env.browser?.storage ?? env.chrome?.storage;
  if (storage)
    return {
      read: async (key) => (await storage.local.get(key))[key],
      write: async (key, value) => {
        await storage.local.set({ [key]: value });
      },
      subscribe(key, listener) {
        const changed = (
          changes: Record<string, StorageChange>,
          area: string,
        ) => {
          if (area === "local" && Object.hasOwn(changes, key))
            listener(changes[key]?.newValue);
        };
        storage.onChanged.addListener(changed);
        return () => {
          storage.onChanged.removeListener(changed);
        };
      },
    };
  const local = env.localStorage;
  if (!local) throw new Error("Local storage unavailable.");
  return {
    read: (key) => {
      return Promise.resolve().then(() => {
        const raw = local.getItem(key);
        return raw === null ? undefined : (JSON.parse(raw) as unknown);
      });
    },
    write: (key, value) => {
      return Promise.resolve().then(() => {
        local.setItem(key, JSON.stringify(value));
      });
    },
    subscribe(key, listener) {
      const changed = (event: StorageEvent) => {
        if (event.key !== key && event.key !== null) return;
        try {
          listener(
            event.newValue === null
              ? undefined
              : (JSON.parse(event.newValue) as unknown),
          );
        } catch {
          listener(undefined);
        }
      };
      env.events?.addEventListener("storage", changed);
      return () => env.events?.removeEventListener("storage", changed);
    },
  };
}
