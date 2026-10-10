import { expect, test } from "bun:test";
import {
  projectSettingsPresentation,
  type SettingsCategory,
} from "../../../src/ui/shell/settings-presentation";

function element(id: string) {
  const attributes = new Map<string, string>();
  const heading = { id: "", tabIndex: 0 };
  const classes = new Set<string>();
  const node = {
    id,
    hidden: false,
    tabIndex: -1,
    dataset: { settingsNav: id, presentation: "" },
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    toggleAttribute: (key: string, enabled: boolean) => {
      if (enabled) attributes.set(key, "");
      else attributes.delete(key);
    },
    querySelector: () => heading,
    classList: {
      toggle: (key: string, enabled: boolean) => {
        if (enabled) classes.add(key);
        else classes.delete(key);
      },
    },
  };
  return { node, attributes, heading };
}

test("settings presentation projects geometry, visibility, inert and navigation semantics together", () => {
  const sheet = element("sheet");
  const appearance = element("appearance");
  const fonts = element("fonts");
  const tab = element("appearance");
  const sections = new Map<SettingsCategory, HTMLElement>([
    ["appearance", appearance.node as unknown as HTMLElement],
    ["fonts", fonts.node as unknown as HTMLElement],
  ]);
  const project = (mode: "modal" | "drawer") => {
    projectSettingsPresentation(
      sheet.node as unknown as HTMLElement,
      [tab.node as unknown as HTMLButtonElement],
      sections,
      mode,
      "appearance",
    );
  };
  project("modal");
  expect(sheet.node.dataset.presentation).toBe("modal");
  expect(fonts.node.hidden).toBe(true);
  expect(fonts.attributes.has("inert")).toBe(true);
  expect(appearance.attributes.get("role")).toBe("tabpanel");
  expect(appearance.attributes.get("aria-labelledby")).toBe("appearance");
  expect(tab.attributes.get("aria-selected")).toBe("true");
  expect(tab.node.tabIndex).toBe(0);
  project("drawer");
  expect(sheet.node.dataset.presentation).toBe("drawer");
  expect(fonts.node.hidden).toBe(false);
  expect(fonts.attributes.has("inert")).toBe(false);
  expect(fonts.attributes.get("aria-hidden")).toBe("false");
  expect(appearance.attributes.get("role")).toBe("region");
  expect(appearance.attributes.get("aria-labelledby")).toBe(
    "appearance-heading",
  );
});
