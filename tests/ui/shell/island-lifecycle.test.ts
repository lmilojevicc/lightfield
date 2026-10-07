import { describe, expect, test } from "bun:test";
import {
  createIslandLifecycle,
  createSearchMorph,
  islandProximityZone,
  withinIslandProximity,
  ISLAND_PROXIMITY_SLACK,
  type IslandScene,
  type IslandProjection,
} from "../../../src/ui/shell/island-lifecycle";

function harness(mode: "normal" | "hidden" = "hidden") {
  const scene: IslandScene = {
    searching: false,
    overlay: false,
    hovered: false,
    focused: false,
    handleFocused: false,
    pointerNear: false,
    busy: false,
    active: true,
  };
  let projection: IslandProjection = {
    tucked: false,
    idle: false,
    handle: false,
  };
  const jobs: (() => void)[] = [];
  const cancelled: unknown[] = [];
  const controller = createIslandLifecycle({
    scene: () => scene,
    project: (value) => {
      projection = value;
    },
    schedule: (done, ms) => {
      expect(ms).toBe(6000);
      jobs.push(done);
      return jobs.length;
    },
    cancel: (handle) => {
      cancelled.push(handle);
    },
  });
  controller.setMode(mode);
  const fire = () => {
    const job = jobs.at(-1);
    if (!job) throw new Error("No idle job");
    job();
  };
  return { scene, controller, jobs, cancelled, fire, view: () => projection };
}

describe("saved Island lifecycle", () => {
  test("Hidden tucks initially; Normal dims after six seconds rather than hiding", () => {
    const hidden = harness();
    expect(hidden.view()).toEqual({ tucked: true, idle: false, handle: true });
    expect(hidden.jobs).toHaveLength(0);
    const normal = harness("normal");
    normal.fire();
    expect(normal.view()).toEqual({ tucked: false, idle: true, handle: false });
  });
  test("new input cancels a stale idle callback and focused controls pin the capsule", () => {
    const h = harness();
    h.controller.reveal();
    const old = h.jobs[0];
    h.scene.focused = true;
    h.controller.activity();
    old?.();
    h.fire();
    expect(h.view().tucked).toBe(false);
    h.scene.focused = false;
    h.controller.settle();
    expect(h.view().tucked).toBe(true);
  });
  test("search, overlays, proximity and pending writes prevent H from losing a live owner", () => {
    for (const key of [
      "searching",
      "overlay",
      "pointerNear",
      "busy",
      "focused",
    ] as const) {
      const h = harness();
      h.controller.reveal();
      h.scene[key] = true;
      h.controller.toggle();
      h.fire();
      expect(h.view().tucked).toBe(false);
    }
  });
  test("slow writes reschedule idle until settled, without requiring another input", () => {
    const h = harness("normal");
    h.scene.busy = true;
    h.fire();
    expect(h.jobs).toHaveLength(2);
    expect(h.view().idle).toBe(false);
    h.scene.busy = false;
    h.fire();
    expect(h.view().idle).toBe(true);
  });
  test("restoring the hidden handle is not a reveal request", () => {
    const h = harness();
    h.controller.reveal();
    h.scene.handleFocused = true;
    h.controller.restoreHandleFocus(() => {
      h.controller.focus();
    });
    expect(h.view().tucked).toBe(true);
    h.controller.focus();
    expect(h.view().tucked).toBe(false);
  });
  test("leaving page activity cannot run a disposed idle job", () => {
    const h = harness("normal");
    h.controller.dispose();
    h.fire();
    expect(h.view().idle).toBe(false);
    expect(h.cancelled).toEqual([1]);
  });
  test("elliptical mouth uses separate entry/exit boundaries", () => {
    const size = { width: 300, height: 48 };
    const entry = islandProximityZone(size, 720, 900);
    const exit = islandProximityZone(size, 720, 900, ISLAND_PROXIMITY_SLACK);
    expect(withinIslandProximity(entry, 970, 900)).toBe(false);
    expect(withinIslandProximity(exit, 970, 900)).toBe(true);
  });
});

test("search morph reversal and reduced-motion finish reject stale width cleanup", () => {
  let searching = false,
    width: number | null = null,
    rendered = 310;
  const jobs: (() => void)[] = [],
    cancelled: unknown[] = [];
  const morph = createSearchMorph({
    width: () => rendered,
    measuring: () => {},
    project: (value) => {
      searching = value;
    },
    naturalWidth: () => (searching ? 620 : 310),
    setWidth: (value) => {
      width = value;
    },
    flush: () => {},
    reducedMotion: () => false,
    schedule: (done, ms) => {
      expect(ms).toBe(400);
      jobs.push(done);
      return jobs.length;
    },
    cancel: (id) => {
      cancelled.push(id);
    },
  });
  const currentWidth = () => width;
  morph.set(true);
  expect(currentWidth()).toBe(620);
  rendered = 480;
  morph.set(false);
  expect(currentWidth()).toBe(310);
  jobs[0]?.();
  expect(currentWidth()).toBe(310);
  morph.finish();
  expect(currentWidth()).toBeNull();
  jobs[1]?.();
  expect(currentWidth()).toBeNull();
  expect(cancelled).toEqual([1, 2]);
});
