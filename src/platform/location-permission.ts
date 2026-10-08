export interface LocationPermissionPort {
  query(): Promise<boolean>;
  request(): Promise<boolean>;
  subscribe(listener: (granted: boolean) => void): () => void;
  dispose(): void;
}

/** A tab-origin permission request; only request() invokes geolocation. */
export function createLocationPermission(
  navigator: Pick<Navigator, "permissions" | "geolocation">,
): LocationPermissionPort {
  let disposed = false;
  let status: PermissionStatus | undefined;
  const listeners = new Set<(granted: boolean) => void>();
  const changed = () => {
    if (!disposed)
      for (const listener of listeners) listener(status?.state === "granted");
  };
  return {
    async query() {
      const next = await navigator.permissions.query({ name: "geolocation" });
      if (disposed) return false;
      if (status !== next) {
        status?.removeEventListener("change", changed);
        status = next;
        status.addEventListener("change", changed);
      }
      return status.state === "granted";
    },
    request() {
      if (disposed) return Promise.resolve(false);
      return new Promise((resolve, reject) => {
        // Start synchronously within the caller's explicit gesture. Coordinates are not retained.
        navigator.geolocation.getCurrentPosition(
          () => {
            resolve(!disposed);
          },
          (error) => {
            if (disposed) resolve(false);
            else
              reject(
                new Error(
                  error.code === 1
                    ? "Location access denied. Retry or enter a city."
                    : "Could not find your location. Retry or enter a city.",
                ),
              );
          },
          { maximumAge: 10 * 60 * 1000, timeout: 8000 },
        );
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      status?.removeEventListener("change", changed);
      listeners.clear();
    },
  };
}
