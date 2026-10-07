export type OrbMode =
  | "orbits"
  | "globe"
  | "rubik"
  | "wave"
  | "web"
  | "braid"
  | "ribbon"
  | "ring"
  | "morph";

export type OrbState =
  | "working"
  | "searching"
  | "solving"
  | "listening"
  | "connecting"
  | "weaving"
  | "composing"
  | "breathing"
  | "shaping";

export interface OrbDot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a?: number;
}

export interface OrbLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  white: number;
  a?: number;
  w: number;
}

export interface OrbFrame {
  dots: OrbDot[];
  lines: OrbLine[];
}

export type OrbOptions = Record<string, number>;
export type OrbFrameGenerator = (size: number, time: number, options: OrbOptions) => OrbFrame;

export const MODE_FRAMES: Readonly<Record<OrbMode, OrbFrameGenerator>>;
export const STATE_TO_MODE: Readonly<Record<OrbState, OrbMode>>;
export function resolvePreset(
  state: OrbState,
  size: number,
): { mode: OrbMode; speed: number; opts: OrbOptions };
