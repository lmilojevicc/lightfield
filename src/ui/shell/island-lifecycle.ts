import type { Settings } from "../../domain/settings/schema";
type IslandMode = Settings["islandMode"];

export const ISLAND_IDLE_MS = 6000;
export const SEARCH_MORPH_MS = 400;
/** Drawer slack around the capsule's slot: how far outside it the pointer still counts as near. */
export const ISLAND_PROXIMITY_PAD = 80;
/** Extra slack the pointer must clear to close the drawer, so boundary jitter cannot flicker it. */
export const ISLAND_PROXIMITY_SLACK = 36;

export function canSubmergeIsland(state: {
  searching: boolean;
  settingsOpen: boolean;
  hidden: boolean;
  hovered: boolean;
  focused: boolean;
  pointerNear: boolean;
  active: boolean;
}): boolean {
  return (
    state.active &&
    !state.searching &&
    !state.settingsOpen &&
    !state.hidden &&
    !state.hovered &&
    !state.focused &&
    !state.pointerNear
  );
}

export interface IslandScene {
  searching: boolean;
  overlay: boolean;
  hovered: boolean;
  focused: boolean;
  handleFocused: boolean;
  /** The pointer sits inside the radial drawer zone around the capsule's slot. */
  pointerNear: boolean;
  busy: boolean;
  active: boolean;
}

export interface IslandProximityZone {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Hidden mode's radial drawer mouth: the capsule's slot padded into one elliptical proximity area.
 *  Anchored one container padding below the slot's bottom edge, which is the viewport's bottom. */
export function islandProximityZone(
  capsule: { width: number; height: number },
  centerX: number,
  bottom: number,
  slack = 0,
): IslandProximityZone {
  const pad = ISLAND_PROXIMITY_PAD + slack;
  return {
    cx: centerX,
    cy: bottom,
    rx: capsule.width / 2 + pad,
    ry: capsule.height + pad,
  };
}

export function withinIslandProximity(
  zone: IslandProximityZone,
  x: number,
  y: number,
): boolean {
  const dx = (x - zone.cx) / zone.rx;
  const dy = (y - zone.cy) / zone.ry;
  return dx * dx + dy * dy <= 1;
}

export interface IslandProjection {
  tucked: boolean;
  idle: boolean;
  handle: boolean;
}

/** One idle clock owns saved Hidden mode, normal submerge and the H override. */
export function createIslandLifecycle(port: {
  scene(): IslandScene;
  project(state: IslandProjection): void;
  schedule(done: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}) {
  let mode: IslandMode | undefined;
  let tucked = false;
  let idle = false;
  let timer: unknown;
  let revision = 0;
  let restoringHandleFocus = false;
  let restoredHandleFocus = false;
  const cancel = () => {
    revision++;
    if (timer !== undefined) port.cancel(timer);
    timer = undefined;
  };
  const project = () => {
    const scene = port.scene();
    // Hidden mode owns the drawer target; handleFocused only guards a focus ring on a live element.
    port.project({
      tucked,
      idle: idle && !tucked,
      handle: !scene.overlay && (mode === "hidden" || scene.handleFocused),
    });
  };
  // A reachable restoration target is not a request to open or pin the capsule.
  const handleEngaged = (scene: IslandScene) =>
    scene.handleFocused && !restoredHandleFocus;
  const protectedScene = (scene: IslandScene) =>
    scene.searching ||
    scene.overlay ||
    scene.focused ||
    handleEngaged(scene) ||
    scene.busy ||
    scene.pointerNear;
  const activity = (): void => {
    cancel();
    idle = false;
    project();
    const scene = port.scene();
    if (tucked || scene.overlay || !scene.active) return;
    const mine = revision;
    timer = port.schedule(() => {
      if (mine !== revision) return;
      timer = undefined;
      const scene = port.scene();
      if (
        !canSubmergeIsland({
          searching: scene.searching,
          settingsOpen: scene.overlay,
          hidden: tucked,
          hovered: scene.hovered,
          focused: scene.focused || handleEngaged(scene),
          pointerNear: scene.pointerNear,
          active: scene.active,
        })
      )
        return;
      // A slow save can settle without input; retain this clock until it does.
      if (scene.busy) {
        activity();
        return;
      }
      if (mode === "hidden") tucked = true;
      else idle = true;
      project();
    }, ISLAND_IDLE_MS);
  };
  const reveal = () => {
    if (port.scene().overlay) return;
    tucked = false;
    activity();
  };
  const settle = () => {
    if (mode === "hidden" && !protectedScene(port.scene())) tucked = true;
    activity();
  };
  return {
    activity,
    settle,
    refresh: project,
    focus() {
      if (restoringHandleFocus) return;
      restoredHandleFocus = false;
      reveal();
    },
    restoreHandleFocus(focus: () => void) {
      restoredHandleFocus = true;
      restoringHandleFocus = true;
      try {
        focus();
      } finally {
        restoringHandleFocus = false;
      }
      settle();
    },
    setMode(next: IslandMode) {
      if (mode === next) {
        project();
        return;
      }
      mode = next;
      // Never tuck a live input or an owned focus target on external updates.
      tucked = next === "hidden" && !protectedScene(port.scene());
      activity();
    },
    reveal,
    toggle() {
      if (port.scene().overlay) return;
      if (tucked) {
        tucked = false;
        activity();
        return;
      }
      if (protectedScene(port.scene())) return;
      // Normal mode always keeps the capsule on screen: H only sinks it to its idle peek there.
      if (mode !== "hidden") {
        if (idle) activity();
        else {
          idle = true;
          cancel();
          project();
        }
        return;
      }
      tucked = true;
      idle = false;
      cancel();
      project();
    },
    dispose: cancel,
  };
}

/** Numeric endpoints avoid the CSS auto→px snap. Reversal cancels stale cleanup. */
export function createSearchMorph(port: {
  width(): number;
  measuring(active: boolean): void;
  project(searching: boolean): void;
  naturalWidth(): number;
  setWidth(width: number | null): void;
  flush(): void;
  reducedMotion(): boolean;
  schedule(done: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}) {
  let searching = false;
  let revision = 0;
  let timer: unknown;
  const finish = () => {
    revision++;
    if (timer !== undefined) port.cancel(timer);
    timer = undefined;
    port.setWidth(null);
  };
  return {
    finish,
    set(next: boolean) {
      if (searching === next) return;
      searching = next;
      const mine = ++revision;
      if (timer !== undefined) port.cancel(timer);
      timer = undefined;
      const from = port.width();
      port.measuring(true);
      port.setWidth(null);
      port.project(next);
      const to = port.naturalWidth();
      port.setWidth(from);
      port.flush();
      port.measuring(false);
      port.flush();
      port.setWidth(to);
      const finish = () => {
        if (mine !== revision) return;
        port.setWidth(null);
        timer = undefined;
      };
      if (port.reducedMotion()) finish();
      else timer = port.schedule(finish, SEARCH_MORPH_MS);
    },
    isSearching: () => searching,
  };
}
