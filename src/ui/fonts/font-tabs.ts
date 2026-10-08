export type FontTab = "presets" | "custom";

/** Automatic activation for the horizontal Fonts tablist. */
export function fontTabForKey(tab: FontTab, key: string): FontTab | undefined {
  if (key === "ArrowLeft" || key === "ArrowRight")
    return tab === "presets" ? "custom" : "presets";
  if (key === "Home") return "presets";
  if (key === "End") return "custom";
  return undefined;
}
