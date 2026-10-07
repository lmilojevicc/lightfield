const themeTokens = [
  "paper",
  "paper-2",
  "paper-3",
  "ink",
  "ink-2",
  "muted",
  "rule",
  "rule-2",
  "accent",
  "accent-ink",
  "focus",
  "accent-text",
  "accent-boundary",
  "control",
  "scrim",
].map((name) => `--color-${name}`);
const surfaceTokens = [
  "bg",
  "solid",
  "fg",
  "muted",
  "border",
  "border-top",
  "input",
  "hover",
  "active",
  "nav",
  "selected",
  "specimen",
  "scrollbar",
  "color-scheme",
  "accent-focus",
  "accent-text",
  "accent-boundary",
  "accent-ink",
].map((name) => `--surface-${name}`);

/** Capture only on entry; subsequent drafts must not recolour the editor surface. */
export function createPreviewSurfaces(
  root: HTMLElement,
  surfaces: readonly HTMLElement[],
) {
  let frozen = false;
  const tokens = [...themeTokens, ...surfaceTokens];
  return {
    capture() {
      if (frozen) return;
      const style = getComputedStyle(root);
      for (const surface of surfaces) {
        for (const token of tokens)
          surface.style.setProperty(token, style.getPropertyValue(token));
        surface.style.colorScheme = style.colorScheme;
      }
      frozen = true;
    },
    clear() {
      if (!frozen) return;
      for (const surface of surfaces) {
        for (const token of tokens) surface.style.removeProperty(token);
        surface.style.removeProperty("color-scheme");
      }
      frozen = false;
    },
  };
}
