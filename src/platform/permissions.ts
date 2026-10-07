export interface PermissionSet {
  permissions?: string[];
  origins?: string[];
}
export interface PermissionAPI {
  contains(request: PermissionSet): Promise<boolean>;
  request(request: PermissionSet): Promise<boolean>;
  onAdded: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
  onRemoved: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
}
export type NetworkPermission = "fonts" | "location";
const REQUESTS: Record<NetworkPermission, PermissionSet> = {
  fonts: { origins: ["https://fonts.googleapis.com/*"] },
  location: { permissions: ["geolocation"] },
};
export interface PermissionSnapshot {
  fonts: boolean;
  location: boolean;
  error: string | null;
}
/** Only request() prompts. Its caller must invoke it directly from the relevant user gesture. */
export function createPermissions(api?: PermissionAPI) {
  let snapshot: PermissionSnapshot = {
    fonts: false,
    location: false,
    error: null,
  };
  let disposed = false,
    generation = 0;
  const listeners = new Set<(snapshot: PermissionSnapshot) => void>();
  const revocations = new Set<() => void>();
  const isDisposed = () => disposed;
  const emit = () => {
    if (!disposed) for (const listener of listeners) listener({ ...snapshot });
  };
  const refresh = async () => {
    const own = ++generation;
    if (!api) {
      snapshot = { ...snapshot, error: "Extension permissions unavailable." };
      emit();
      return;
    }
    try {
      const [fonts, location] = await Promise.all([
        api.contains(REQUESTS.fonts),
        api.contains(REQUESTS.location),
      ]);
      if (disposed || own !== generation) return;
      snapshot = { fonts, location, error: null };
      emit();
    } catch (error) {
      if (!disposed && own === generation) {
        snapshot = {
          fonts: false,
          location: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not check permissions.",
        };
        emit();
      }
    }
  };
  const changed = () => {
    void refresh();
  };
  const removed = () => {
    // Revoke synchronously; contains() may settle after nonabortable network work.
    generation++;
    snapshot = { fonts: false, location: false, error: null };
    for (const listener of revocations) listener();
    emit();
    void refresh();
  };
  api?.onAdded.addListener(changed);
  api?.onRemoved.addListener(removed);
  return {
    current: () => ({ ...snapshot }),
    subscribe(listener: (snapshot: PermissionSnapshot) => void) {
      listeners.add(listener);
      listener({ ...snapshot });
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeRevocation(listener: () => void) {
      revocations.add(listener);
      return () => {
        revocations.delete(listener);
      };
    },
    refresh,
    async request(feature: NetworkPermission): Promise<boolean> {
      if (disposed || !api)
        throw new Error("Extension permissions unavailable.");
      try {
        // Call before any await: preserve browser user-gesture authority.
        const granted = await api.request(REQUESTS[feature]);
        if (isDisposed()) return false;
        await refresh();
        if (!granted) {
          snapshot = {
            ...snapshot,
            error:
              feature === "fonts"
                ? "Google Fonts access denied. Retry or choose an offline font."
                : "Location access denied. Retry or enter a city.",
          };
          emit();
        }
        return granted;
      } catch (error) {
        if (!isDisposed()) {
          snapshot = {
            ...snapshot,
            error:
              error instanceof Error
                ? error.message
                : "Permission request failed.",
          };
          emit();
        }
        throw error;
      }
    },
    dispose() {
      disposed = true;
      generation++;
      api?.onAdded.removeListener(changed);
      api?.onRemoved.removeListener(removed);
      listeners.clear();
      revocations.clear();
    },
  };
}
export type PermissionSession = ReturnType<typeof createPermissions>;
