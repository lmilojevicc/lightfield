import { expect, test } from "bun:test";
import { fontTabForKey } from "../../../src/ui/fonts/font-tabs";

test("Fonts horizontal tabs wrap and support Home/End without taking editor keys", () => {
  for (const key of ["ArrowLeft", "ArrowRight"]) {
    expect(fontTabForKey("presets", key)).toBe("custom");
    expect(fontTabForKey("custom", key)).toBe("presets");
  }
  for (const tab of ["presets", "custom"] as const) {
    expect(fontTabForKey(tab, "Home")).toBe("presets");
    expect(fontTabForKey(tab, "End")).toBe("custom");
    for (const key of ["Tab", "Escape", "Enter", "ArrowDown", "a"])
      expect(fontTabForKey(tab, key)).toBeUndefined();
  }
});
