import { requiredValue } from "../../src/effects/runtime/required-value";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { BackgroundController } from "../../src/effects/runtime/controller";
import type {
  BackgroundContext,
  BackgroundInstance,
  ThemePalette,
} from "../../src/effects/runtime/contracts";
import type { PageActivity } from "../../src/platform/page-activity";

class Node {
  dataset: Record<string, string> = {};
  className = "";
  style: Record<string, string> = {};
  textContent = "";
  children: Node[] = [];
  removed = false;
  replaceChildren(...children: Node[]) {
    this.children = children;
  }
  append(child: Node) {
    this.children.push(child);
  }
  querySelector() {
    return null;
  }
  setAttribute() {}
  removeAttribute(name: string) {
    if (name === "data-error") delete this.dataset.error;
  }
  remove() {
    this.removed = true;
  }
}
const palette: ThemePalette = {
  paper: [0, 0, 0],
  paperHex: "#000000",
  ink: [1, 1, 1],
  inkHex: "#ffffff",
  accent: [1, 0, 0],
  accentHex: "#ff0000",
  focus: [1, 0, 0],
  focusHex: "#ff0000",
  lightTheme: false,
};
const originals = new Map<string, PropertyDescriptor | undefined>();
let now: number,
  nextTimer: number,
  timers: Map<number, { fn: () => void; due: number }>,
  motion: boolean;
let controllers: BackgroundController[];
function install(key: string, value: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
function runDue() {
  for (const [id, timer] of [...timers])
    if (timer.due <= now) {
      timers.delete(id);
      timer.fn();
    }
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
beforeEach(() => {
  now = 1000;
  nextTimer = 0;
  timers = new Map();
  controllers = [];
  motion = false;
  install("document", { hidden: false, createElement: () => new Node() });
  install("window", { addEventListener() {}, removeEventListener() {} });
  install("matchMedia", () => ({
    get matches() {
      return motion;
    },
    addEventListener() {},
    removeEventListener() {},
  }));
  install(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  install("setTimeout", (fn: () => void, ms: number) => {
    const id = ++nextTimer;
    timers.set(id, { fn, due: now + ms });
    return id;
  });
  install("clearTimeout", (id: number) => {
    timers.delete(id);
  });
  originals.set("dateNow", Object.getOwnPropertyDescriptor(Date, "now"));
  Object.defineProperty(Date, "now", { configurable: true, value: () => now });
});
afterEach(() => {
  for (const controller of controllers) controller.destroy();
  for (const [key, descriptor] of originals) {
    if (key === "dateNow") {
      if (descriptor) Object.defineProperty(Date, "now", descriptor);
      continue;
    }
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});
function fixture(
  initiallyActive = true,
  loader?: (
    context: BackgroundContext,
  ) => BackgroundInstance | Promise<BackgroundInstance>,
) {
  let active = initiallyActive;
  const listeners = new Set<(active: boolean) => void>();
  const activity: PageActivity = {
    isActive: () => active,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const contexts: BackgroundContext[] = [],
    updates: boolean[] = [],
    destroyed: number[] = [];
  const host = new Node();
  const controller = new BackgroundController(host as unknown as HTMLElement, {
    loaders: {
      fractal: () =>
        Promise.resolve({
          default: (context: BackgroundContext) => {
            const index = contexts.push(context) - 1;
            return (
              loader?.(context) ?? {
                update(state) {
                  updates.push(state.visible);
                },
                resize() {},
                destroy() {
                  destroyed.push(index);
                },
              }
            );
          },
        }),
    },
    activity,
    reducedMotion: () => motion,
    subscribeReducedMotion: () => () => {},
    resolveAsset: (path) => `/assets/${path}`,
    images: {
      assets: {
        get() {
          return Promise.resolve(undefined);
        },
      },
      prepare() {
        return Promise.reject(new Error("unexpected preparation"));
      },
    },
  });
  controllers.push(controller);
  return {
    controller,
    host,
    contexts,
    updates,
    destroyed,
    listeners,
    activity(next: boolean) {
      if (next === active) return;
      active = next;
      for (const fn of [...listeners]) fn(active);
    },
    async set(config = {}, nextPalette = palette) {
      await controller.set("fractal", { fractal: config }, nextPalette);
    },
  };
}

test("warm renderer pauses immediately, preserves identity/time for 59,999ms, releases once at 60,000ms", async () => {
  const f = fixture();
  await f.set();
  expect(f.contexts).toHaveLength(1);
  f.activity(false);
  expect(f.updates.at(-1)).toBe(false);
  expect(timers.size).toBe(1);
  now += 59_999;
  runDue();
  expect(f.destroyed).toHaveLength(0);
  f.activity(true);
  await flush();
  expect(f.contexts).toHaveLength(1);
  expect(f.destroyed).toHaveLength(0);
  f.activity(false);
  now += 60_000;
  runDue();
  expect(f.destroyed).toEqual([0]);
  expect(
    f.host.children.some((node) => node.className === "background-preview"),
  ).toBe(true);
  f.activity(true);
  await flush();
  expect(f.destroyed).toEqual([0]);
  expect(f.contexts).toHaveLength(2);
  expect(
    f.host.children.some((node) => node.className === "background-preview"),
  ).toBe(true);
  requiredValue(f.contexts[0]).reportPaint?.();
  expect(
    f.host.children.some((node) => node.className === "background-preview"),
  ).toBe(true);
  requiredValue(f.contexts[1]).reportPaint?.();
  expect(
    f.host.children.find((node) => node.className === "background-preview")
      ?.removed,
  ).toBe(true);
});

test("overdue background timer is reconciled synchronously on regain without double release", async () => {
  const f = fixture();
  await f.set();
  f.activity(false);
  now += 62_000;
  f.activity(true);
  await flush();
  expect(f.destroyed).toEqual([0]);
  expect(f.contexts).toHaveLength(2);
  runDue();
  expect(f.destroyed).toEqual([0]);
});

test("inactive boot defers import and hidden changes coalesce to latest palette/config", async () => {
  const f = fixture(false);
  await f.set({ opacity: 0.3 });
  await f.set({ opacity: 0.7 }, { ...palette, lightTheme: true });
  expect(f.contexts).toHaveLength(0);
  f.activity(true);
  await flush();
  expect(f.contexts).toHaveLength(1);
  expect(requiredValue(f.contexts[0]).config.opacity).toBe(0.7);
  expect(requiredValue(f.contexts[0]).palette.lightTheme).toBe(true);
  expect(
    f.host.children.some((node) => node.className === "background-preview"),
  ).toBe(true);
  requiredValue(f.contexts[0]).reportPaint?.();
  expect(
    f.host.children.find((node) => node.className === "background-preview")
      ?.removed,
  ).toBe(true);
});

test("stale asynchronous factory cannot adopt or clear preview; newest reduced-motion state paints", async () => {
  let resolve!: (instance: BackgroundInstance) => void;
  let destroyedStale = 0;
  let first = true;
  const f = fixture(true, () => {
    if (first) {
      first = false;
      return new Promise<BackgroundInstance>((yes) => {
        resolve = yes;
      });
    }
    return { update() {}, resize() {}, destroy() {} };
  });
  const pending = f.set();
  await flush();
  const stale = requiredValue(f.contexts[0]);
  f.activity(false);
  motion = true;
  await f.set({ opacity: 0.4 });
  resolve({
    update() {},
    resize() {},
    destroy() {
      destroyedStale++;
    },
  });
  await pending;
  expect(destroyedStale).toBe(1);
  f.activity(true);
  await flush();
  expect(f.contexts.at(-1)?.reducedMotion).toBe(true);
  expect(f.contexts.at(-1)?.config.opacity).toBe(0.4);
  stale.reportPaint?.();
  expect(
    f.host.children.some(
      (node) => node.className === "background-preview" && !node.removed,
    ),
  ).toBe(true);
  requiredValue(f.contexts.at(-1)).reportPaint?.();
  expect(
    f.host.children.find((node) => node.className === "background-preview")
      ?.removed,
  ).toBe(true);
});

for (const fault of ["throw", "report"] as const)
  test(`paint before adoption update ${fault} retains fallback and disposes once`, async () => {
    let disposes = 0;
    const f = fixture(true, (context) => {
      context.reportPaint?.(); // Native constructor painted before the instance was adopted.
      return {
        update() {
          if (fault === "throw") throw new Error("painted update failed");
          context.reportRuntimeFailure(new Error("painted runtime failure"));
        },
        resize() {},
        destroy() {
          disposes++;
        },
      };
    });
    await f.set();
    expect(disposes).toBe(1);
    expect(f.host.dataset.error).toBeDefined();
    expect(f.host.children).toHaveLength(1);
    expect(requiredValue(f.host.children[0]).className).toBe(
      "background-preview",
    );
    expect(requiredValue(f.host.children[0]).removed).toBe(false);
    expect(f.controller.diagnostic?.stage).toBe(
      fault === "throw" ? "update" : "runtime",
    );
  });

test("runtime failure and explicit retry keep fallback until the replacement really paints", async () => {
  const f = fixture();
  await f.set();
  requiredValue(f.contexts[0]).reportRuntimeFailure(
    new Error("WebGL context lost"),
  );
  expect(
    f.host.children.some(
      (node) => node.className === "background-preview" && !node.removed,
    ),
  ).toBe(true);
  await f.controller.retry();
  expect(f.contexts).toHaveLength(2);
  expect(
    f.host.children.some(
      (node) => node.className === "background-preview" && !node.removed,
    ),
  ).toBe(true);
  requiredValue(f.contexts[0]).reportPaint?.();
  expect(
    f.host.children.some(
      (node) => node.className === "background-preview" && !node.removed,
    ),
  ).toBe(true);
  requiredValue(f.contexts[1]).reportPaint?.();
  expect(
    f.host.children.find((node) => node.className === "background-preview")
      ?.removed,
  ).toBe(true);
});

test("hidden source mismatch destroys old instance immediately and imports only latest on resume", async () => {
  const f = fixture();
  await f.set();
  f.activity(false);
  await f.controller.set("none", {}, palette);
  expect(f.destroyed).toEqual([0]);
  await f.set({ opacity: 0.8 });
  expect(f.contexts).toHaveLength(1);
  f.activity(true);
  await flush();
  expect(f.contexts).toHaveLength(2);
  expect(requiredValue(f.contexts[1]).config.opacity).toBe(0.8);
});

test("typed status readiness follows actual paint and activity release; stale paint cannot reveal a replacement", async () => {
  const f = fixture();
  const states: boolean[] = [];
  const stop = f.controller.subscribe((status) => {
    states.push(status.ready);
  });
  await f.set();
  expect(f.controller.current()).toMatchObject({
    id: "fractal",
    ready: false,
    active: true,
    mounting: false,
  });
  requiredValue(f.contexts[0]).reportPaint?.();
  expect(f.controller.current().ready).toBe(true);
  f.activity(false);
  expect(f.controller.current().active).toBe(false);
  now += 60_000;
  runDue();
  await flush();
  expect(f.controller.current()).toMatchObject({
    ready: false,
    idleReleased: true,
  });
  f.activity(true);
  await flush();
  requiredValue(f.contexts[0]).reportPaint?.();
  expect(f.controller.current().ready).toBe(false);
  requiredValue(f.contexts[1]).reportPaint?.();
  expect(f.controller.current().ready).toBe(true);
  expect(states).toContain(false);
  stop();
  f.controller.destroy();
  expect(f.controller.isActive()).toBe(false);
});
