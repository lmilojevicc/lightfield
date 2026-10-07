import { afterEach, expect, test } from "bun:test";
import { createPreviewSurfaces } from "../../../src/app/preview-surfaces";

const original = globalThis.getComputedStyle;
afterEach(() => {
  globalThis.getComputedStyle = original;
});
function surface() {
  const tokens = new Map<string, string>();
  const style = {
    colorScheme: "",
    setProperty(key: string, value: string) {
      tokens.set(key, value);
    },
    removeProperty(key: string) {
      tokens.delete(key);
      if (key === "color-scheme") this.colorScheme = "";
    },
  };
  return { element: { style } as unknown as HTMLElement, tokens, style };
}
test("theme preview freezes both authored surfaces once and releases every token", () => {
  let color = "durable";
  let reads = 0;
  globalThis.getComputedStyle = () => {
    reads++;
    return {
      colorScheme: "dark",
      getPropertyValue: (key: string) => `${color}:${key}`,
    } as CSSStyleDeclaration;
  };
  const panel = surface(),
    tuner = surface();
  const owner = createPreviewSurfaces({} as HTMLElement, [
    panel.element,
    tuner.element,
  ]);
  owner.capture();
  color = "draft";
  owner.capture();
  expect(reads).toBe(1);
  expect(panel.tokens.get("--color-paper")).toBe("durable:--color-paper");
  expect(tuner.tokens.get("--surface-accent-focus")).toBe(
    "durable:--surface-accent-focus",
  );
  expect(tuner.style.colorScheme).toBe("dark");
  owner.clear();
  owner.clear();
  expect(panel.tokens.size).toBe(0);
  expect(tuner.tokens.size).toBe(0);
  expect(panel.style.colorScheme).toBe("");
  color = "new durable";
  owner.capture();
  expect(reads).toBe(2);
  expect(panel.tokens.get("--surface-bg")).toBe("new durable:--surface-bg");
  owner.clear();
});
