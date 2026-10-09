import type {
  CustomTheme,
  CustomThemeImportResult,
  ThemePalette,
} from "../shared/theme";
import type {
  Settings,
  SettingsPatch,
  PersistenceStatusSnapshot,
} from "../domain/settings/schema";
import type { FontTuple } from "../domain/fonts/font-commit-state";
import type { FontFamily } from "../domain/fonts/font-pairings";
import type { PreparedLocalImage } from "../platform/images/local-image-loading";
import type { LocalImageAssetStore } from "../platform/images/local-image-store";
import type { PermissionSession } from "../platform/permissions";
import type { LocalImageThumbnail } from "./local-image-thumbnail";
import type { ImageIntent } from "./local-image-workflow";
import type { OwnedPageActivity } from "../platform/page-activity";
import type { WeatherChipView } from "./weather-chip";
export interface SettingsSnapshot {
  settings: Settings;
  durable: Settings;
  persistence: PersistenceStatusSnapshot;
  persistenceRevision: number;
  error: string | null;
  ready: boolean;
  unsupportedImage: boolean;
  imageMutationsAvailable: boolean;
}
export interface SettingsDraft {
  commit(): Promise<Settings>;
  cancel(): void;
}
export interface SettingsSession {
  stage(patch: SettingsPatch): SettingsDraft;
  current(): SettingsSnapshot;
  subscribe(listener: (snapshot: SettingsSnapshot) => void): () => void;
  patch(patch: SettingsPatch): Promise<Settings>;
  retry(): Promise<Settings>;
  clearSavedStatus(revision: number): boolean;
  reload(): Promise<void>;
  destroy(): void;
}
export interface ThemeSession {
  createId(): string;
  current(): readonly CustomTheme[];
  subscribe(listener: (themes: readonly CustomTheme[]) => void): () => void;
  save(theme: CustomTheme, editingId: string | null): Promise<void>;
  remove(id: string): Promise<void>;
  undo(): Promise<void>;
  import(raw: string): Promise<CustomThemeImportResult>;
  export(): string;
  exportOne(id: string): string;
}
export interface FontSnapshot {
  state: "idle" | "loading" | "ready" | "error";
  error: string | null;
  display: FontFamily | null;
  body: FontFamily | null;
}
export interface FontPreview {
  display: FontFamily;
  body: FontFamily;
  dispose(): void;
}
export interface FontSession {
  preview(
    display: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<FontPreview>;
  current(): FontSnapshot;
  subscribe(listener: (snapshot: FontSnapshot) => void): () => void;
  save(display: string, body: string): Promise<void>;
  preset(tuple: FontTuple): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
}
export interface ImageSessionIntent extends ImageIntent {
  epoch: number;
  background: Settings["background"];
}
export interface ImageSnapshot {
  state: "idle" | "saving" | "error";
  error: string | null;
  cleanupPending: boolean;
}
export interface ImageSession {
  current(): ImageSnapshot;
  subscribe(listener: (snapshot: ImageSnapshot) => void): () => void;
  createThumbnail(): LocalImageThumbnail;
  assets: Pick<LocalImageAssetStore, "get">;
  prepare(
    blob: Blob,
    fit: "cover" | "contain",
    signal?: AbortSignal,
  ): Promise<PreparedLocalImage>;
  intent(): ImageSessionIntent;
  import(
    blob: Blob,
    expected: ImageSessionIntent,
    fit: "cover" | "contain",
    signal: AbortSignal,
  ): Promise<PreparedLocalImage>;
  change(
    operation: "use" | "remove" | "cover" | "contain",
    expected: ImageSessionIntent,
    signal?: AbortSignal,
  ): Promise<Settings>;
}
export interface AppServices {
  permissions: PermissionSession;
  ready: Promise<void>;
  settings: SettingsSession;
  themes: ThemeSession;
  fonts: FontSession;
  images: ImageSession;
  activity: OwnedPageActivity;
  weather: {
    current(): WeatherChipView;
    subscribe(listener: (view: WeatherChipView) => void): () => void;
    refresh(): Promise<void>;
  };
  /** Supply the styled root after mounting; built-in CSS remains UI-owned. */
  applyTheme(root: HTMLElement): ThemePalette;
  notifyConsentChanged(): void;
  applyFonts(root: HTMLElement): void;
  observeClockFont(element: HTMLElement): { refresh(): void; dispose(): void };
  reducedMotion(): boolean;
  subscribeReducedMotion(listener: (reduced: boolean) => void): () => void;
  dispose(): void;
}
