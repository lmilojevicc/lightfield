export type FontSaveKind = "custom" | "preset" | null;

/** Source protects only custom-editor commits; preset persistence never traps Settings. */
export function fontSaveBlocksClose(
  kind: FontSaveKind,
  slow: boolean,
): boolean {
  return kind === "custom" && !slow;
}

/** A submitted font save is protected for ten seconds, then may finish behind a dismissed editor. */
export function createFontSaveBarrier(port: {
  schedule(callback: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
  slow(value: boolean): void;
}) {
  let timer: unknown;
  let revision = 0;
  function finish() {
    revision++;
    if (timer !== undefined) port.cancel(timer);
    timer = undefined;
    port.slow(false);
  }
  return {
    begin() {
      finish();
      const mine = revision;
      timer = port.schedule(() => {
        if (mine === revision) port.slow(true);
      }, 10000);
    },
    finish,
  };
}
