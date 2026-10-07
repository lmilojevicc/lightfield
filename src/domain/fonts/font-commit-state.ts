import type { Settings } from "../settings/schema";

export type FontTuple = Pick<
  Settings,
  "fonts" | "customDisplayFont" | "customBodyFont"
>;
export function fontTuple(settings: FontTuple): FontTuple {
  return {
    fonts: settings.fonts,
    customDisplayFont: settings.customDisplayFont,
    customBodyFont: settings.customBodyFont,
  };
}
export function sameFontTuple(a: FontTuple, b: FontTuple): boolean {
  return (
    a.fonts === b.fonts &&
    a.customDisplayFont === b.customDisplayFont &&
    a.customBodyFont === b.customBodyFont
  );
}

/** Pending faces are not active settings. Ordered storage events after our durable
 * echo supersede the submitted tuple, even if its promise has not settled yet. */
export class FontCommitState {
  private echoed = false;
  private latest: FontTuple | null = null;
  constructor(readonly patch: FontTuple) {}
  observe(incoming: FontTuple): boolean {
    this.latest = fontTuple(incoming);
    const ownEcho = sameFontTuple(incoming, this.patch);
    if (ownEcho) this.echoed = true;
    return ownEcho;
  }
  failedTuple(): FontTuple | null {
    return this.latest;
  }
  savedTuple(): FontTuple {
    return this.echoed && this.latest ? this.latest : this.patch;
  }
}
