import { expect, test } from "bun:test";
import { normalize } from "../../src/domain/settings/schema";
import {
  canonicalHexColor,
  parseCustomThemeExport,
  serializeCustomThemeExport,
  analyzeCustomThemeContrast,
  normalizeCustomTheme,
  customThemeSemanticTokens,
  hexContrastRatio,
  evaluateCustomThemeContrast,
} from "../../src/domain/themes/custom-themes";
import {
  createCustomThemePreviewState,
  customThemePreviewTransition,
  createSerialMutationQueue,
  persistCustomThemeTransaction,
  deleteCustomTheme,
  restoreDeletedCustomTheme,
} from "../../src/domain/themes/custom-theme-workflow";
const theme = {
  id: "custom:one",
  name: "One",
  paper: "#11111b",
  ink: "#eeeeee",
  accent: "#74c7ec",
};
test("fresh settings ignore dormant name and custom names remain validated", () => {
  expect(normalize({ name: "legacy greeting" })).not.toHaveProperty("name");
  expect(normalizeCustomTheme({ ...theme, name: " Name " })?.name).toBe("Name");
  expect(normalizeCustomTheme({ ...theme, name: " " })).toBeNull();
  expect(canonicalHexColor("#ABCDEF")).toBe("#abcdef");
});
test("lightfield exports, explicit Meridian imports, collisions, unknown keys and versions", () => {
  const exported = serializeCustomThemeExport([theme]);
  expect(exported).toContain("lightfield.custom-themes");
  expect(parseCustomThemeExport(exported, [], () => "two").themes).toEqual([
    theme,
  ]);
  const result = parseCustomThemeExport(
    exported.replace("lightfield.custom-themes", "meridian.custom-themes"),
    [theme],
    () => "two",
  );
  expect(result.remappedCount).toBe(1);
  expect(result.themes[1]?.id).toBe("custom:two");
  for (const raw of [
    "not json",
    JSON.stringify({ schema: "lightfield.custom-themes", version: 2, themes: [] }),
    JSON.stringify({
      schema: "lightfield.custom-themes",
      version: 1,
      themes: [{ ...theme, url: "https://bad.invalid" }],
    }),
    JSON.stringify({
      schema: "lightfield.custom-themes",
      version: 1,
      themes: [theme, theme],
    }),
  ])
    expect(() => parseCustomThemeExport(raw, [], () => "id")).toThrow(
      "Nothing was changed",
    );
});
test("semantic roles preserve source contrast constraints, low contrast remains importable with warnings", () => {
  const low = { ...theme, ink: "#12121c" };
  expect(analyzeCustomThemeContrast(low).length).toBeGreaterThan(0);
  expect(
    parseCustomThemeExport(serializeCustomThemeExport([low]), [], () => "id")
      .warningCount,
  ).toBeGreaterThan(0);
  const semantic = customThemeSemanticTokens(
    theme.paper,
    theme.ink,
    theme.accent,
  );
  expect(semantic).not.toBeNull();
  if (!semantic) throw new Error("Missing semantic colors");
  expect(hexContrastRatio(semantic.muted, theme.paper)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(
    evaluateCustomThemeContrast(theme).every(
      (value) => value.ratio >= value.minimum,
    ),
  ).toBe(true);
});
test("preview cancel, delete/undo collision remap and serial queue rollback ownership", async () => {
  const state = createCustomThemePreviewState(theme);
  const draft = { ...theme, accent: "#ff0000" };
  const preview = customThemePreviewTransition(state, {
    type: "preview",
    theme: draft,
  });
  expect(
    customThemePreviewTransition(preview, { type: "cancel" }).applied,
  ).toEqual(theme);
  const deleted = deleteCustomTheme([theme], theme.id, theme.id, "midnight");
  if (!deleted.undo) throw new Error("Missing undo");
  expect(
    restoreDeletedCustomTheme(
      [theme],
      deleted.undo,
      () => "custom:remap",
      "midnight",
    ).nextThemeId,
  ).toBe("custom:remap");
  const writes: string[] = [];
  const result = await persistCustomThemeTransaction(
    { previousThemes: [theme], nextThemes: [], nextThemeId: "midnight" },
    {
      writeThemes: (values) => {
        writes.push(String(values.length));
      },
      writeThemeSelection: () => Promise.resolve(false),
    },
  );
  expect(result).toEqual({ ok: false, reason: "selection-write" });
  expect(writes).toEqual(["0", "1"]);
  const queue = createSerialMutationQueue();
  const order: number[] = [];
  await Promise.all([
    queue.run(() => {
      order.push(1);
    }),
    queue.run(() => {
      order.push(2);
    }),
  ]);
  expect(order).toEqual([1, 2]);
  expect(queue.isBusy()).toBe(false);
});
