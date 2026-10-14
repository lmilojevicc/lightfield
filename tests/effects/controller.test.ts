import { requiredValue } from "../../src/effects/runtime/required-value";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  BackgroundController,
  type BackgroundLoader,
} from "../../src/effects/runtime/controller";
import { backgroundFailureMessage } from "../../src/effects/runtime/failure";
import type {
  BackgroundContext,
  BackgroundControllerOptions,
  BackgroundInstance,
  ThemePalette,
} from "../../src/effects/runtime/contracts";

class Node {
  dataset: Record<string, string> = {};
  textContent = "";
  className = "";
  style: Record<string, string> = {};
  removed = false;
  children: Node[] = [];
  querySelector() {
    return null;
  }
  setAttribute() {}
  append(child: Node) {
    this.children.push(child);
  }
  remove() {
    this.removed = true;
  }
  replaceChildren(...children: Node[]) {
    this.children = children;
  }
  removeAttribute(name: string) {
    if (name === "data-error") delete this.dataset.error;
  }
}
const palette = {
  paper: [0, 0, 0],
  paperHex: "#000000",
  ink: [1, 1, 1],
  inkHex: "#ffffff",
  accent: [1, 0, 0],
  accentHex: "#ff0000",
  focus: [1, 0, 0],
  focusHex: "#ff0000",
  lightTheme: false,
} satisfies ThemePalette;
const originals = new Map<string, PropertyDescriptor | undefined>();
let visible: boolean,
  motion: boolean,
  timers: Map<number, () => void>,
  listeners: Map<string, () => void>;
let controllers: BackgroundController[];
let timerId: number;
let now: number;
function install(key: string, value: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
beforeEach(() => {
  visible = true;
  motion = false;
  timers = new Map();
  listeners = new Map();
  controllers = [];
  timerId = 0;
  now = 1000;
  originals.set("dateNow", Object.getOwnPropertyDescriptor(Date, "now"));
  Object.defineProperty(Date, "now", { configurable: true, value: () => now });
  install("document", {
    get hidden() {
      return !visible;
    },
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    createElement: () => new Node(),
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  });
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
  install("setTimeout", (fn: () => void, delay: number) => {
    expect(delay).toBe(1000);
    timers.set(++timerId, fn);
    return timerId;
  });
  install("clearTimeout", (id: number) => timers.delete(id));
});
afterEach(() => {
  for (const c of controllers) c.destroy();
  for (const [key, descriptor] of originals) {
    if (key === "dateNow") {
      if (descriptor) Object.defineProperty(Date, "now", descriptor);
      else Reflect.deleteProperty(Date, "now");
      continue;
    }
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});
const unusedImages = {
  assets: {
    get() {
      return Promise.resolve(undefined);
    },
  },
  prepare() {
    return Promise.reject(new Error("unexpected preparation"));
  },
};
function fixture(
  loader?: BackgroundLoader,
  localLoader?: BackgroundControllerOptions["localImageLoader"],
) {
  const contexts: BackgroundContext[] = [];
  const destroyed: number[] = [];
  const host = new Node(),
    status = new Node();
  const loaders = {
    fractal:
      loader ??
      (() =>
        Promise.resolve({
          default: (context: BackgroundContext) => {
            const index = contexts.push(context) - 1;
            return {
              update() {},
              resize() {},
              destroy() {
                destroyed.push(index);
                context.reportRuntimeFailure(new Error("intentional destroy"));
              },
            };
          },
        })),
    ascii: () =>
      Promise.resolve({
        default: () => ({ update() {}, resize() {}, destroy() {} }),
      }),
  };
  const controller = new BackgroundController(host as unknown as HTMLElement, {
    loaders,
    ...(localLoader ? { localImageLoader: localLoader } : {}),
    statusElement: status as unknown as HTMLElement,
    activity: {
      isActive: () => visible,
      subscribe(fn) {
        listeners.set("visibilitychange", () => {
          fn(visible);
        });
        return () => {
          listeners.delete("visibilitychange");
        };
      },
    },
    reducedMotion: () => motion,
    subscribeReducedMotion: () => () => {},
    resolveAsset: (path) => `/assets/${path}`,
    images: unusedImages,
  });
  controllers.push(controller);
  return { controller, contexts, destroyed, host, status, loaders };
}
async function advance() {
  const pending = [...timers.values()];
  timers.clear();
  for (const fn of pending) fn();
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function visibility(next: boolean) {
  visible = next;
  listeners.get("visibilitychange")?.();
}

test("controller: one delayed recovery; own echoes do not reset budget, source/config and explicit Retry do", async () => {
  const f = fixture();
  const overrides = { fractal: { opacity: 0.8 } };
  const snapshot = JSON.stringify(overrides);
  await f.controller.set("fractal", overrides, palette, undefined, 8);
  requiredValue(f.contexts[0]).reportRuntimeFailure(
    new Error("WebGL context lost"),
  );
  expect(f.destroyed).toEqual([0]);
  expect(f.controller.diagnostic).toMatchObject({
    id: "fractal",
    stage: "runtime",
    reason: "context-lost",
    retry: "scheduled",
  });
  for (let i = 0; i < 5; i++)
    await f.controller.set(
      "fractal",
      structuredClone(overrides),
      structuredClone(palette),
      undefined,
      8 + i,
    );
  expect(f.contexts.length).toBe(1);
  expect(timers.size).toBe(1);
  expect(f.host.dataset.background).toBe("fractal");
  await advance();
  expect(f.contexts.length).toBe(2);
  expect(f.status.textContent).toBe("");
  expect(f.controller.diagnostic?.retry).toBe("recovered");
  requiredValue(f.contexts[1]).reportRuntimeFailure(new Error("GL draw throw"));
  expect(timers.size).toBe(0);
  expect(f.controller.diagnostic?.retry).toBe("stopped");
  await f.controller.set("fractal", overrides, palette);
  expect(f.contexts.length).toBe(2);
  expect(f.status.textContent).toContain("GL draw throw");
  await f.controller.retry();
  expect(f.contexts.length).toBe(3);
  requiredValue(f.contexts[2]).reportRuntimeFailure(new Error("again"));
  expect(timers.size).toBe(1);
  await f.controller.set("fractal", { fractal: { opacity: 0.6 } }, palette);
  expect(timers.size).toBe(0);
  expect(f.contexts.at(-1)?.config.opacity).toBe(0.6);
  requiredValue(f.contexts.at(-1)).reportRuntimeFailure(
    new Error("new config episode"),
  );
  expect(timers.size).toBe(1);
  expect(JSON.stringify(overrides)).toBe(snapshot);
});

test("controller: hidden failures defer the same budget; pending retries cancel on hide/source/destroy", async () => {
  const f = fixture();
  await f.controller.set("fractal", {}, palette);
  visibility(false);
  requiredValue(f.contexts[0]).reportRuntimeFailure(new Error("context lost"));
  expect(timers.size).toBe(0);
  expect(f.controller.diagnostic?.retry).toBe("deferred");
  await f.controller.set("fractal", {}, palette);
  visibility(true);
  expect(timers.size).toBe(1);
  visibility(false);
  expect(timers.size).toBe(0);
  visibility(true);
  await advance();
  expect(f.contexts.length).toBe(2);
  requiredValue(f.contexts[1]).reportRuntimeFailure(new Error("context lost"));
  visibility(false);
  visibility(true);
  expect(timers.size).toBe(0);
  await f.controller.retry();
  requiredValue(f.contexts.at(-1)).reportRuntimeFailure(new Error("runtime"));
  expect(timers.size).toBe(1);
  await f.controller.set("none", {}, palette);
  expect(timers.size).toBe(0);
  await advance();
  expect(f.host.dataset.background).toBe("none");
  await f.controller.set("fractal", {}, palette);
  requiredValue(f.contexts.at(-1)).reportRuntimeFailure(new Error("runtime"));
  f.controller.destroy();
  expect(timers.size).toBe(0);
  await advance();
  expect(f.destroyed).toEqual([0, 1, 2, 3]);
});

for (const source of ["ascii", "none"] as const)
  test(`controller: stale old callbacks and rapid pending recovery cannot replace ${source}`, async () => {
    const f = fixture();
    await f.controller.set("fractal", {}, palette);
    const old = requiredValue(f.contexts[0]);
    old.reportRuntimeFailure(new Error("context lost"));
    await f.controller.set(source, {}, palette);
    old.reportRuntimeFailure(new Error("late failure"));
    await advance();
    expect(f.host.dataset.background).toBe(source);
    expect(f.host.dataset.error).toBeUndefined();
    expect(f.destroyed).toEqual([0]);
    expect(timers.size).toBe(0);
  });

for (const fault of [
  "import",
  "constructor",
  "compile",
  "unsupported",
] as const)
  test(`controller: ${fault} failure preserves selection, stops, offers explicit retry`, async () => {
    let calls = 0;
    const f = fixture(() => {
      calls++;
      if (fault === "import")
        throw Error(
          "Failed to fetch dynamically imported module: chrome-extension://private/chunk.js",
        );
      return Promise.resolve({
        default: () => {
          throw Error(
            fault === "compile"
              ? "Shader compilation failed"
              : fault === "unsupported"
                ? "WebGL not supported"
                : "Constructor failed",
          );
        },
      });
    });
    await f.controller.set("fractal", {}, palette);
    expect(calls).toBe(1);
    expect(timers.size).toBe(0);
    expect(f.host.dataset.background).toBe("fractal");
    expect(f.controller.diagnostic?.stage).toBe(
      fault === "import" ? "import" : "startup",
    );
    if (fault === "import") {
      expect(f.status.textContent).toContain("reload this tab");
      expect(f.status.textContent).not.toContain("private");
    }
    await f.controller.set("fractal", {}, palette);
    expect(calls).toBe(1);
    await f.controller.retry();
    expect(calls).toBe(2);
    expect(timers.size).toBe(0);
  });

test("controller: adoption update throw cleans once, failed automatic startup stops", async () => {
  let calls = 0,
    destroys = 0;
  const f = fixture(() =>
    Promise.resolve({
      default: () => {
        calls++;
        return {
          update() {
            throw Error("Injected GL draw throw");
          },
          resize() {},
          destroy() {
            destroys++;
          },
        };
      },
    }),
  );
  await f.controller.set("fractal", {}, palette);
  expect(destroys).toBe(1);
  expect(f.controller.diagnostic?.stage).toBe("update");
  await advance();
  expect(calls).toBe(2);
  expect(destroys).toBe(2);
  expect(timers.size).toBe(0);
  f.controller.destroy();
  expect(destroys).toBe(2);
});

test("controller: retry lazy adoption reads latest palette and motion, hidden import defers before GPU allocation", async () => {
  const f = fixture();
  await f.controller.set("fractal", {}, palette);
  requiredValue(f.contexts[0]).reportRuntimeFailure(new Error("context lost"));
  let resolve!: (module: {
    default: (context: BackgroundContext) => BackgroundInstance;
  }) => void;
  f.loaders.fractal = () =>
    new Promise((yes) => {
      resolve = yes;
    });
  const retry = f.controller.retry();
  visibility(false);
  motion = true;
  let allocations = 0;
  const factory = (context: BackgroundContext) => {
    allocations++;
    expect(context.reducedMotion).toBe(true);
    expect(context.visible).toBe(true);
    return { update() {}, resize() {}, destroy() {} };
  };
  resolve({ default: factory });
  await retry;
  expect(allocations).toBe(0);
  expect(f.controller.diagnostic?.retry).toBe("deferred");
  f.loaders.fractal = () => Promise.resolve({ default: factory });
  visibility(true);
  await advance();
  expect(allocations).toBe(1);
});

test("failure diagnostics redact URLs and raw image payloads, bound messages", () => {
  const message = backgroundFailureMessage(
    new Error(
      "bad blob:https://private/a data:image/png;base64," +
        "A".repeat(400) +
        " https://private/image.jpg",
    ),
  );
  expect(message).not.toContain("private");
  expect(message).not.toContain("AAAA");
  expect(message.length).toBeLessThanOrEqual(240);
});

test("controller: synchronous startup reporter disposes returned failed resource once and never retries", async () => {
  let destroys = 0;
  const f = fixture(() =>
    Promise.resolve({
      default: (context) => {
        context.reportRuntimeFailure(new Error("first draw failed"));
        return {
          update() {},
          resize() {},
          destroy() {
            destroys++;
          },
        };
      },
    }),
  );
  await f.controller.set("fractal", {}, palette);
  expect(destroys).toBe(1);
  expect(f.controller.diagnostic?.stage).toBe("startup");
  expect(timers.size).toBe(0);
  f.controller.destroy();
  expect(destroys).toBe(1);
});

test("controller: pending retry cannot adopt over ASCII; latest explicit retry uses current config/palette", async () => {
  const f = fixture();
  await f.controller.set("fractal", {}, palette);
  requiredValue(f.contexts[0]).reportRuntimeFailure(new Error("context lost"));
  let resolve!: (instance: BackgroundInstance) => void,
    destroys = 0;
  f.loaders.fractal = () =>
    Promise.resolve({
      default: () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    });
  const retry = f.controller.retry();
  await Promise.resolve();
  await f.controller.set("ascii", {}, palette);
  resolve({
    update() {},
    resize() {},
    destroy() {
      destroys++;
    },
  });
  await retry;
  expect(destroys).toBe(1);
  expect(f.host.dataset.background).toBe("ascii");
  expect(timers.size).toBe(0);
  const latest = { ...palette, lightTheme: true, paperHex: "#ffffff" };
  let received: BackgroundContext | undefined;
  f.loaders.fractal = () =>
    Promise.resolve({
      default: (context) => {
        received = context;
        throw Error("constructor fault");
      },
    });
  await f.controller.set("fractal", { fractal: { opacity: 0.4 } }, latest);
  await f.controller.retry();
  expect(received?.config.opacity).toBe(0.4);
  expect(received?.palette).toEqual(latest);
  expect(f.host.dataset.background).toBe("fractal");
});

function preparedCandidate(
  dispose: () => void,
): import("../../src/platform/images/local-image-loading").PreparedLocalImage {
  return {
    image: {} as HTMLImageElement,
    metadata: {
      mime: "image/png",
      bytes: 128,
      width: 640,
      height: 360,
      orientation: 1,
    },
    width: 640,
    height: 360,
    dispose,
  };
}

for (const destroyWhileLoading of [false, true])
  test(`controller: rejected Local Image import releases its exclusive candidate once (destroy pending: ${String(destroyWhileLoading)})`, async () => {
    let disposals = 0;
    let rejectImport: ((reason: Error) => void) | undefined;
    const f = fixture(
      undefined,
      () =>
        new Promise((_resolve, reject) => {
          rejectImport = reject;
        }),
    );
    const pending = f.controller.set(
      "local-image",
      {},
      palette,
      undefined,
      0,
      preparedCandidate(() => {
        disposals++;
      }),
    );
    if (destroyWhileLoading) f.controller.destroy();
    requiredValue(rejectImport)(new Error("Local Image import failed"));
    await pending;
    expect(disposals).toBe(1);
    if (!destroyWhileLoading)
      expect(f.controller.current().message).toBe("Local Image import failed");
    f.controller.destroy();
    expect(disposals).toBe(1);
  });

test("controller: failed Local Image construction owns candidate disposal after renderer handoff", async () => {
  let disposals = 0;
  const f = fixture();
  // Actual renderer rejects the default missing asset and disposes its candidate.
  await f.controller.set(
    "local-image",
    {},
    palette,
    undefined,
    0,
    preparedCandidate(() => {
      disposals++;
    }),
  );
  expect(f.controller.current().message).toContain("Saved image unavailable");
  expect(disposals).toBe(1);
  f.controller.destroy();
  expect(disposals).toBe(1);
});

test("controller: repeated frames notify readiness once and stale generations never notify", async () => {
  const f = fixture();
  await f.controller.set("fractal", {}, palette);
  const updates: boolean[] = [];
  const stop = f.controller.subscribe((status) => {
    updates.push(status.ready);
  });
  updates.length = 0;
  requiredValue(f.contexts[0]).reportPaint?.();
  expect(updates).toEqual([true]);
  for (let frame = 0; frame < 20; frame++)
    requiredValue(f.contexts[0]).reportPaint?.();
  expect(updates).toEqual([true]);
  await f.controller.set("none", {}, palette);
  await f.controller.set("fractal", {}, palette);
  updates.length = 0;
  requiredValue(f.contexts[0]).reportPaint?.();
  expect(updates).toEqual([]);
  requiredValue(f.contexts[1]).reportPaint?.();
  requiredValue(f.contexts[1]).reportPaint?.();
  expect(updates).toEqual([true]);
  stop();
});
