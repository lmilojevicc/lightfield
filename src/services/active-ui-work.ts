// Activity gates for UI-only work. Callers retain ownership of their writes and
// cancel/invalidate in-flight reads in suspend; a resumed read uses current state.
export interface ActivitySignal {
  isActive(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}

export function createActiveClock(
  activity: ActivitySignal,
  tick: () => void,
  timers: Pick<typeof globalThis, "setInterval" | "clearInterval"> = globalThis,
): { refresh(): void; dispose(): void } {
  let interval: ReturnType<typeof setInterval> | undefined;
  const change = (active: boolean) => {
    if (!active) {
      if (interval !== undefined) timers.clearInterval(interval);
      interval = undefined;
    } else if (interval === undefined) {
      tick();
      interval = timers.setInterval(() => {
        if (activity.isActive()) tick();
      }, 1000);
    }
  };
  const unsubscribe = activity.subscribe(change);
  change(activity.isActive());
  return {
    refresh: () => {
      if (activity.isActive()) tick();
    },
    dispose: () => {
      unsubscribe();
      change(false);
    },
  };
}

export function createActiveEffect(
  activity: ActivitySignal,
  run: () => Promise<void> | void,
  suspend: () => boolean = () => false,
): { request(): Promise<void> | undefined; dispose(): void } {
  let pending = false;
  let disposed = false;
  const request = (): Promise<void> | undefined => {
    if (disposed) return;
    if (!activity.isActive()) {
      pending = true;
      return;
    }
    pending = false;
    return Promise.resolve(run());
  };
  const unsubscribe = activity.subscribe((active) => {
    if (!active) {
      if (suspend()) pending = true;
    } else if (pending) void request();
  });
  return {
    request,
    dispose: () => {
      disposed = true;
      unsubscribe();
    },
  };
}
