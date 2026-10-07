import { requiredValue } from "../domain/required-value";
import { clockCellWidths } from "../domain/clock-digits";
/** Fixed glyph cells preserve node identity and geometry across clock rollovers.
 * The parent time element owns the full locale-aware accessible name. */
export function updateClockDigits(element: HTMLElement, value: string): void {
  element.classList.add("clock-digits");
  element.setAttribute("aria-hidden", "true");
  if (element.children.length !== value.length) {
    element.replaceChildren(
      ...Array.from(value, (character) => {
        const cell = document.createElement("span");
        cell.className = character === ":" ? "clock-separator" : "clock-digit";
        cell.textContent = character;
        return cell;
      }),
    );
  } else
    Array.from(value).forEach((character, index) => {
      const cell = requiredValue(element.children[index]);
      if (cell.textContent !== character) cell.textContent = character;
    });
}

/** One current-style cache, invalidated by font completion (including fallback
 * replacement). No promises retain an old family; every callback reads live CSS.
 * Tick never calls this controller or performs a layout read. */
export function observeClockFont(element: HTMLElement): {
  refresh(): void;
  dispose(): void;
} {
  element.classList.add("clock-digits");
  const properties = [
    "fontFamily",
    "fontWeight",
    "fontSize",
    "fontStyle",
    "fontStretch",
    "fontKerning",
    "fontVariantNumeric",
    "fontFeatureSettings",
    "fontVariationSettings",
    "fontOpticalSizing",
    "letterSpacing",
  ] as const;
  let signature = "";
  const refresh = () => {
    const style = getComputedStyle(element);
    const key = properties.map((property) => style[property]).join("|");
    if (signature === key) return;
    const size = parseFloat(style.fontSize);
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;white-space:nowrap;left:0;top:0;line-height:1;";
    for (const property of properties) probe.style[property] = style[property];
    const glyphs = Array.from("0123456789:", (character) => {
      const glyph = document.createElement("span");
      glyph.style.display = "inline-block";
      glyph.textContent = character;
      probe.append(glyph);
      return glyph;
    });
    document.body.append(probe);
    const canvas = document.createElement("canvas").getContext("2d");
    if (canvas) {
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      canvas.fontKerning = "none";
    }
    const metrics = glyphs.map((glyph) => {
      const advance = glyph.getBoundingClientRect().width;
      const ink = canvas?.measureText(glyph.textContent);
      // DOM is authoritative for advance. Canvas contributes only overhang,
      // relative to its own advance, not a potentially different shaping width.
      return {
        advance,
        left: ink?.actualBoundingBoxLeft ?? 0,
        right: advance + (ink ? ink.actualBoundingBoxRight - ink.width : 0),
      };
    });
    probe.remove();
    const widths = clockCellWidths(
      metrics.slice(0, 10),
      requiredValue(metrics[10]),
    );
    element.style.setProperty(
      "--clock-digit-width",
      `${String(widths.digit / size)}em`,
    );
    element.style.setProperty(
      "--clock-separator-width",
      `${String(widths.separator / size)}em`,
    );
    signature = key;
  };
  const fontReady = () => {
    signature = "";
    refresh();
  };
  document.fonts.addEventListener("loadingdone", fontReady);
  document.fonts.addEventListener("loadingerror", fontReady);
  window.addEventListener("resize", refresh);
  refresh();
  return {
    refresh,
    dispose() {
      document.fonts.removeEventListener("loadingdone", fontReady);
      document.fonts.removeEventListener("loadingerror", fontReady);
      window.removeEventListener("resize", refresh);
    },
  };
}
