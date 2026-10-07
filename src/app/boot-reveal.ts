/** Source initial-work/paint reveal, capped at 900 ms even on rejected or stalled initialization. */
export function createBootReveal(options: {
  reveal(): void;
  schedule(callback: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
}) {
  let initialized = false;
  let painted = false;
  let live = true;
  let shown = false;
  const reveal = () => {
    if (!live || shown) return;
    shown = true;
    if (timer !== undefined) options.cancel(timer);
    options.reveal();
  };
  const timer = options.schedule(reveal, 900);
  return {
    initialized() {
      initialized = true;
      if (painted) reveal();
    },
    painted() {
      painted = true;
      if (initialized) reveal();
    },
    failed: reveal,
    dispose() {
      live = false;
      if (timer !== undefined) options.cancel(timer);
    },
  };
}
