import { expect, test } from "bun:test";
import { applyTheme, readThemePalette } from "../../src/platform/theme";
import { ISLAND_THEME_PALETTES, hexToRgb } from "../../src/shared/theme";
test("DOM palette supplies active theme explicitly and clears custom tokens when switching to built-in CSS", () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const values = new Map<string, string>();
  const style = {
    setProperty: (key: string, value: string) => {
      values.set(key, value);
    },
    removeProperty: (key: string) => {
      values.delete(key);
    },
    getPropertyValue: (key: string) => values.get(key) ?? "",
    colorScheme: "",
  };
  const root = {
    dataset: { theme: "midnight" },
    style,
    getAttribute: () => null,
  } as unknown as HTMLElement;
  let fill = "#11111b";
  const context = {
    clearRect: () => {},
    fillRect: () => {},
    get fillStyle() {
      return fill;
    },
    set fillStyle(value: string) {
      if (/^#[0-9a-f]{6}$/i.test(value)) fill = value;
    },
    getImageData: () => ({
      data: [
        parseInt(fill.slice(1, 3), 16),
        parseInt(fill.slice(3, 5), 16),
        parseInt(fill.slice(5, 7), 16),
        255,
      ],
    }),
  };
  for (const [key, value] of Object.entries({
    document: {
      createElement: () => ({ width: 1, height: 1, getContext: () => context }),
    },
    getComputedStyle: () => style,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  try {
    const palette = readThemePalette(root);
    const authored = ISLAND_THEME_PALETTES.midnight;
    if (!authored) throw new Error("Missing theme");
    expect(palette.shaderPalette).toEqual([
      hexToRgb(authored[0]),
      hexToRgb(authored[1]),
      hexToRgb(authored[2]),
      hexToRgb(authored[3]),
    ]);
    const theme = {
      id: "custom:one",
      name: "One",
      paper: "#eeeeee",
      ink: "#111111",
      accent: "#0055aa",
    };
    const custom = applyTheme(root, theme.id, [theme]);
    expect(custom.paperHex).toBe("#eeeeee");
    expect(custom.lightTheme).toBe(true);
    expect(values.get("--color-accent")).toBe("#0055aa");
    expect(style.colorScheme).toBe("light");
    applyTheme(root, "midnight", [theme]);
    expect(values.size).toBe(0);
    expect(root.dataset.theme).toBe("midnight");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
