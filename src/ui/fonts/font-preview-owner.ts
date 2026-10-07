import type { FontPreview, FontSession } from "../../services/contracts";

/** One disposable specimen owner; saved roles remain native-owned. */
export function createFontPreviewOwner(fonts: Pick<FontSession, "preview">) {
  let generation = 0;
  let abort: AbortController | undefined;
  let current: FontPreview | undefined;
  function clear() {
    generation++;
    abort?.abort();
    abort = undefined;
    current?.dispose();
    current = undefined;
  }
  return {
    clear,
    async load(
      display: string,
      body: string,
    ): Promise<FontPreview | undefined> {
      clear();
      const ticket = generation;
      abort = new AbortController();
      try {
        const value = await fonts.preview(display, body, abort.signal);
        if (ticket !== generation) {
          value.dispose();
          return undefined;
        }
        current = value;
        return value;
      } catch (error) {
        if (
          ticket !== generation ||
          abort.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        )
          return undefined;
        throw error;
      }
    },
  };
}
