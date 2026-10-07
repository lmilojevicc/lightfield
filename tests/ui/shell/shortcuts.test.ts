import { expect, test } from "bun:test";
import { shortcutAction } from "../../../src/ui/shell/shortcuts";
const event = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  defaultPrevented: false,
  ...mods,
});
const idle = { overlay: false, searching: false, editing: false };
test("slash/comma/H exclude text editing and overlays; command-K may select a live search input", () => {
  expect(shortcutAction(event("/"), idle)).toBe("search");
  expect(shortcutAction(event(","), idle)).toBe("settings");
  expect(shortcutAction(event("H"), idle)).toBe("hide");
  for (const key of ["/", ",", "H"]) {
    expect(
      shortcutAction(event(key), { ...idle, editing: true }),
    ).toBeUndefined();
    expect(
      shortcutAction(event(key), { ...idle, overlay: true }),
    ).toBeUndefined();
    expect(shortcutAction(event(key, { altKey: true }), idle)).toBeUndefined();
  }
  expect(
    shortcutAction(event("K", { metaKey: true }), { ...idle, editing: true }),
  ).toBe("search");
  expect(
    shortcutAction(event("k", { ctrlKey: true }), { ...idle, overlay: true }),
  ).toBeUndefined();
  expect(
    shortcutAction(event("h"), { ...idle, searching: true }),
  ).toBeUndefined();
  expect(
    shortcutAction(event("/", { defaultPrevented: true }), idle),
  ).toBeUndefined();
});
