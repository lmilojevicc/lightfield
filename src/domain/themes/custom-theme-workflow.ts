import type { CustomTheme } from "../settings/schema";

export interface CustomThemePreviewState {
  selected: CustomTheme | null;
  draft: CustomTheme | null;
  applied: CustomTheme | null;
}

export type CustomThemePreviewEvent =
  | { type: "select"; theme: CustomTheme | null }
  | { type: "preview"; theme: CustomTheme }
  | { type: "invalid-draft" }
  | { type: "cancel" }
  | { type: "save"; theme: CustomTheme };

export function createCustomThemePreviewState(
  selected: CustomTheme | null,
): CustomThemePreviewState {
  return { selected, draft: null, applied: selected };
}

/** Pure draft lifecycle used by the live editor and fast behavioral checks. */
export function customThemePreviewTransition(
  state: CustomThemePreviewState,
  event: CustomThemePreviewEvent,
): CustomThemePreviewState {
  switch (event.type) {
    case "select":
      return { selected: event.theme, draft: null, applied: event.theme };
    case "preview":
      return { ...state, draft: event.theme, applied: event.theme };
    case "invalid-draft":
      return { ...state, draft: null };
    case "cancel":
      return { ...state, draft: null, applied: state.selected };
    case "save":
      return { selected: event.theme, draft: null, applied: event.theme };
  }
}

export function saveCustomThemeDraft(
  themes: readonly CustomTheme[],
  editingId: string | null,
  draft: CustomTheme,
): CustomTheme[] {
  if (!editingId) return [...themes, draft];
  return themes.map((theme) =>
    theme.id === editingId ? { ...draft, id: editingId } : theme,
  );
}

export interface DeletedCustomTheme {
  theme: CustomTheme;
  selected: boolean;
}

export function deleteCustomTheme(
  themes: readonly CustomTheme[],
  id: string,
  selectedThemeId: string,
  fallbackThemeId: string,
): {
  themes: CustomTheme[];
  nextThemeId: string;
  undo: DeletedCustomTheme | null;
} {
  const theme = themes.find((candidate) => candidate.id === id);
  if (!theme)
    return { themes: [...themes], nextThemeId: selectedThemeId, undo: null };
  const selected = selectedThemeId === id;
  return {
    themes: themes.filter((candidate) => candidate.id !== id),
    nextThemeId: selected ? fallbackThemeId : selectedThemeId,
    undo: { theme, selected },
  };
}

export function restoreDeletedCustomTheme(
  themes: readonly CustomTheme[],
  undo: DeletedCustomTheme,
  createUniqueId: (usedIds: Iterable<string>) => string,
  selectedThemeId: string,
  reselect = true,
): {
  themes: CustomTheme[];
  restored: CustomTheme;
  nextThemeId: string;
  remapped: boolean;
} {
  const collision = themes.some((theme) => theme.id === undo.theme.id);
  const restored = collision
    ? { ...undo.theme, id: createUniqueId(themes.map((theme) => theme.id)) }
    : undo.theme;
  return {
    themes: [...themes, restored],
    restored,
    nextThemeId: undo.selected && reselect ? restored.id : selectedThemeId,
    remapped: collision,
  };
}
