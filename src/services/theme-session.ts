import {
  DEFAULT_SETTINGS,
  normalize,
  mergeSettingsPatch,
  type ExclusiveRunner,
} from "../domain/settings/schema";
import {
  CUSTOM_THEMES_KEY,
  validateCustomThemes,
  parseStoredCustomThemes,
  normalizeCustomTheme,
  duplicateCustomTheme,
  parseCustomThemeExport,
  serializeCustomThemeExport,
  createUniqueCustomThemeId,
} from "../domain/themes/custom-themes";
import {
  deleteCustomTheme,
  restoreDeletedCustomTheme,
  saveCustomThemeDraft,
  type DeletedCustomTheme,
} from "../domain/themes/custom-theme-workflow";
import type { CustomTheme, CustomThemeImportResult } from "../shared/theme";
import type { StorageAdapter } from "../platform/storage/browser-storage";
import type { NativeSettingsSession } from "./settings-session";
import type { ThemeSession } from "./contracts";
export class NativeThemeSession implements ThemeSession {
  private themes: CustomTheme[] = [];
  private listeners = new Set<(themes: readonly CustomTheme[]) => void>();
  private deleted: DeletedCustomTheme | null = null;
  private disposed = false;
  private generation = 0;
  private unsubscribe: () => void;
  constructor(
    private readonly storage: StorageAdapter,
    private readonly settings: NativeSettingsSession,
    private readonly exclusive: ExclusiveRunner,
    private readonly randomUUID: () => string,
  ) {
    this.unsubscribe = storage.subscribe(CUSTOM_THEMES_KEY, (raw) => {
      this.accept(raw);
    });
  }
  private accept(raw: unknown): void {
    if (this.disposed) return;
    this.generation++;
    this.themes = parseStoredCustomThemes(
      typeof raw === "string"
        ? raw
        : raw === undefined
          ? null
          : JSON.stringify(raw),
    );
    for (const listener of this.listeners) listener(this.current());
  }
  async load(): Promise<void> {
    const generation = this.generation;
    const raw = await this.storage.read(CUSTOM_THEMES_KEY);
    if (generation === this.generation) this.accept(raw);
  }
  createId(): string {
    return createUniqueCustomThemeId(
      this.themes.map((theme) => theme.id),
      this.randomUUID,
    );
  }
  current(): readonly CustomTheme[] {
    return structuredClone(this.themes);
  }
  subscribe(listener: (themes: readonly CustomTheme[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private mutate(
    build: (
      themes: CustomTheme[],
      selected: string,
    ) => { themes: CustomTheme[]; selected: string },
  ): Promise<void> {
    if (this.disposed)
      return Promise.reject(new Error("Theme session disposed."));
    return this.exclusive(async () => {
      const raw = await this.storage.read(CUSTOM_THEMES_KEY);
      const previous = parseStoredCustomThemes(
        typeof raw === "string"
          ? raw
          : raw === undefined
            ? null
            : JSON.stringify(raw),
      );
      const current = await this.settings.store.read();
      const selected = normalize(current).theme;
      const change = build(previous, selected);
      const valid = validateCustomThemes(change.themes);
      const next = mergeSettingsPatch(current, { theme: change.selected });
      await this.storage.write(CUSTOM_THEMES_KEY, valid);
      try {
        await this.settings.store.write(next);
      } catch (error) {
        // A rejected Promise can still have committed; read back before rolling back the collection.
        const persisted = await this.settings.store.read();
        if (!(
          persisted &&
          typeof persisted === "object" &&
          "theme" in persisted &&
          persisted.theme === next.theme
        )) {
          await this.storage.write(CUSTOM_THEMES_KEY, previous);
          this.accept(previous);
          throw error;
        }
      }
      this.accept(valid);
      this.settings.publish(next);
    });
  }
  save(theme: CustomTheme, editingId: string | null): Promise<void> {
    const valid = normalizeCustomTheme(theme);
    if (!valid) return Promise.reject(new Error("A custom theme is invalid."));
    return this.mutate((themes) => {
      if (editingId && !themes.some((theme) => theme.id === editingId))
        throw new Error(
          "This custom theme was removed in another tab. Create a new theme from the draft.",
        );
      return {
        themes: saveCustomThemeDraft(themes, editingId, valid),
        selected: editingId ?? valid.id,
      };
    });
  }
  duplicate(theme: CustomTheme): Promise<void> {
    return this.mutate((themes) => {
      const copy = duplicateCustomTheme(
        theme,
        this.randomUUID,
        themes.map((value) => value.id),
      );
      return { themes: [...themes, copy], selected: copy.id };
    });
  }
  async remove(id: string): Promise<void> {
    let undo: DeletedCustomTheme | null = null;
    await this.mutate((themes, selected) => {
      const result = deleteCustomTheme(
        themes,
        id,
        selected,
        DEFAULT_SETTINGS.theme,
      );
      undo = result.undo;
      return { themes: result.themes, selected: result.nextThemeId };
    });
    this.deleted = undo;
  }
  async undo(): Promise<void> {
    const deleted = this.deleted;
    if (!deleted) return;
    await this.mutate((themes, selected) => {
      const result = restoreDeletedCustomTheme(
        themes,
        deleted,
        (used) => createUniqueCustomThemeId(used, this.randomUUID),
        selected,
      );
      return { themes: result.themes, selected: result.nextThemeId };
    });
    this.deleted = null;
  }
  async import(raw: string): Promise<CustomThemeImportResult> {
    const output: { result?: CustomThemeImportResult } = {};
    await this.mutate((themes, selected) => {
      output.result = parseCustomThemeExport(raw, themes, this.randomUUID);
      return { themes: output.result.themes, selected };
    });
    if (!output.result) throw new Error("Import did not complete.");
    return output.result;
  }
  export(): string {
    return serializeCustomThemeExport(this.themes);
  }
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
  }
}
