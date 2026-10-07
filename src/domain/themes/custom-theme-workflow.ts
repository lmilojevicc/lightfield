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

export interface SerialMutationQueue {
  run<T>(task: () => Promise<T> | T): Promise<T>;
  isBusy(): boolean;
}

/**
 * Run mutation transactions one at a time. `task` is intentionally invoked
 * only when its turn begins so callers take rollback snapshots from the state
 * left by the previous successful transaction.
 */
export function createSerialMutationQueue(
  onBusyChange: (busy: boolean) => void = () => {},
): SerialMutationQueue {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    run<T>(task: () => Promise<T> | T): Promise<T> {
      pending += 1;
      if (pending === 1) onBusyChange(true);
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result.finally(() => {
        pending -= 1;
        if (pending === 0) onBusyChange(false);
      });
    },
    isBusy(): boolean {
      return pending > 0;
    },
  };
}

export interface CustomThemeTransactionInput {
  previousThemes: readonly CustomTheme[];
  nextThemes: readonly CustomTheme[];
  nextThemeId: string;
}

export interface CustomThemeTransactionDependencies {
  writeThemes(themes: readonly CustomTheme[]): void;
  writeThemeSelection(themeId: string): Promise<boolean>;
}

export type CustomThemeTransactionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "themes-write" | "selection-write" | "rollback-write";
    };

/**
 * Persist the collection before selection, then restore the exact prior
 * collection if the queued settings write fails.
 */
export async function persistCustomThemeTransaction(
  input: CustomThemeTransactionInput,
  dependencies: CustomThemeTransactionDependencies,
): Promise<CustomThemeTransactionResult> {
  try {
    dependencies.writeThemes(input.nextThemes);
  } catch {
    return { ok: false, reason: "themes-write" };
  }

  if (await dependencies.writeThemeSelection(input.nextThemeId))
    return { ok: true };

  try {
    dependencies.writeThemes(input.previousThemes);
  } catch {
    return { ok: false, reason: "rollback-write" };
  }
  return { ok: false, reason: "selection-write" };
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
    nextThemeId: undo.selected ? restored.id : selectedThemeId,
    remapped: collision,
  };
}
