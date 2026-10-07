import type {
  BackgroundControlValue,
  BackgroundId,
} from "../../shared/background-metadata";

import type { ThemePalette } from "../../shared/theme";
export type { ThemePalette } from "../../shared/theme";

export interface BackgroundContext {
  host: HTMLElement;
  config: Record<string, BackgroundControlValue>;
  palette: ThemePalette;
  reducedMotion: boolean;
  visible: boolean;
  reportRuntimeFailure(error?: unknown): void;
  /** Signal only after this generation actually completed a successful canvas/WebGL paint. */
  reportPaint?(): void;
}

export type BackgroundUpdateContext = Omit<
  BackgroundContext,
  "host" | "reportRuntimeFailure" | "reportPaint"
>;

export interface BackgroundInstance {
  configure?(
    settings: import("../../shared/local-image").LocalImageSettings,
  ): void;
  update(context: BackgroundUpdateContext): void;
  resize(): void;
  destroy(): void;
}

export type BackgroundFactory = (
  context: BackgroundContext,
) => Promise<BackgroundInstance> | BackgroundInstance;

export interface BackgroundControllerState {
  id: BackgroundId;
  config: Record<string, BackgroundControlValue>;
  palette: ThemePalette;
}

import type { ImageSession } from "../../services/contracts";
import type { PageActivity } from "../../platform/page-activity";
import type { BackgroundFailure } from "./failure";
import type { BackgroundLoader } from "./loaders";
export interface BackgroundStatus {
  id: BackgroundId;
  active: boolean;
  ready: boolean;
  mounting: boolean;
  idleReleased: boolean;
  message: string;
  filterMessage: string;
  diagnostic: Readonly<BackgroundFailure> | null;
}
/** Integration owns page activity, motion and extension URL resolution. */
export interface BackgroundControllerOptions {
  activity: PageActivity;
  images: Pick<ImageSession, "assets" | "prepare">;
  reducedMotion(): boolean;
  subscribeReducedMotion(listener: (reduced: boolean) => void): () => void;
  resolveAsset(path: string): string;
  loaders?: Partial<Record<BackgroundId, BackgroundLoader>>;
  localImageLoader?: typeof import("./loaders").localImageLoader;
  statusElement?: HTMLElement;
  onFailure?: (failure: Readonly<BackgroundFailure> | null) => void;
}
