import { browserPageEnvironment } from "../../src/platform/browser";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createPageActivity } from "../../src/platform/page-activity";

const originals = new Map<string, PropertyDescriptor | undefined>();
const events = new Map<string, Set<() => void>>();
type CurrentWindow = { id?: number; focused?: boolean };
let hidden: boolean, focused: boolean;
let resolveCurrent: (value: CurrentWindow) => void;
let rejectCurrent: (error: Error) => void;
let windowFocus: Set<(id: number) => void>;
function install(key: string, value: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
function listen(name: string, fn: () => void) {
  let set = events.get(name);
  if (!set) events.set(name, (set = new Set()));
  set.add(fn);
}
function unlisten(name: string, fn: () => void) {
  events.get(name)?.delete(fn);
}
function fire(name: string) {
  for (const fn of [...(events.get(name) ?? [])]) fn();
}
function chromeWindowFocus(id: number) {
  for (const fn of [...windowFocus]) fn(id);
}
async function current(id: number, isFocused: boolean) {
  resolveCurrent({ id, focused: isFocused });
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => {
  hidden = false;
  focused = true;
  events.clear();
  windowFocus = new Set();
  install("document", {
    get hidden() {
      return hidden;
    },
    hasFocus: () => focused,
    addEventListener: listen,
    removeEventListener: unlisten,
  });
  install("window", {
    addEventListener: listen,
    removeEventListener: unlisten,
  });
  install("chrome", {
    windows: {
      getCurrent: () =>
        new Promise<CurrentWindow>((yes, no) => {
          resolveCurrent = yes;
          rejectCurrent = no;
        }),
      onFocusChanged: {
        addListener: (fn: (id: number) => void) => windowFocus.add(fn),
        removeListener: (fn: (id: number) => void) => windowFocus.delete(fn),
      },
    },
  });
});
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("active when omnibox owns DOM focus, but not when the browser window loses focus", async () => {
  const activity = createPageActivity(browserPageEnvironment());
  const changes: boolean[] = [];
  activity.subscribe((next) => changes.push(next));
  expect(activity.isActive()).toBe(false); // No canvas/other work before window ownership resolves.
  await current(42, true);
  expect(changes).toEqual([true]);
  focused = false;
  fire("blur");
  expect(activity.isActive()).toBe(true);
  chromeWindowFocus(-1);
  expect(activity.isActive()).toBe(false);
  chromeWindowFocus(7);
  expect(activity.isActive()).toBe(false);
  chromeWindowFocus(42);
  expect(activity.isActive()).toBe(true);
  expect(changes).toEqual([true, false, true]);
  activity.dispose();
});

test("initial unfocused boot, focus event racing getCurrent, and hidden visibility reconcile", async () => {
  const activity = createPageActivity(browserPageEnvironment());
  const changes: boolean[] = [];
  activity.subscribe((next) => changes.push(next));
  chromeWindowFocus(-1);
  await current(42, true);
  expect(activity.isActive()).toBe(false);
  chromeWindowFocus(42);
  hidden = true;
  fire("visibilitychange");
  expect(activity.isActive()).toBe(false);
  hidden = false;
  fire("visibilitychange");
  expect(activity.isActive()).toBe(false);
  await current(42, true);
  expect(activity.isActive()).toBe(true);
  expect(changes).toEqual([true, false, true]);
  activity.dispose();
  const initiallyUnfocused = createPageActivity(browserPageEnvironment());
  await current(42, false);
  expect(initiallyUnfocused.isActive()).toBe(false);
  initiallyUnfocused.dispose();
});

test("pagehide/pageshow and dispose notify exactly once, remove observers", async () => {
  const activity = createPageActivity(browserPageEnvironment());
  await current(42, true);
  const changes: boolean[] = [];
  const unsubscribe = activity.subscribe((next) => changes.push(next));
  fire("pagehide");
  fire("pagehide");
  expect(activity.isActive()).toBe(false);
  hidden = true;
  fire("visibilitychange");
  fire("pageshow");
  expect(activity.isActive()).toBe(false);
  hidden = false;
  fire("visibilitychange");
  await current(42, true);
  expect(activity.isActive()).toBe(true);
  unsubscribe();
  chromeWindowFocus(-1);
  expect(changes).toEqual([false, true]);
  activity.dispose();
  activity.dispose();
  expect(windowFocus.size).toBe(0);
  chromeWindowFocus(42);
  fire("pagehide");
  expect(activity.isActive()).toBe(false);
});

test("pageshow and visibility return stay inactive until fresh window focus is confirmed", async () => {
  const activity = createPageActivity(browserPageEnvironment());
  await current(42, true);
  const changes: boolean[] = [];
  activity.subscribe((next) => changes.push(next));
  fire("pagehide");
  fire("pageshow");
  expect(activity.isActive()).toBe(false);
  await current(42, false);
  expect(activity.isActive()).toBe(false);
  chromeWindowFocus(42);
  await current(42, true);
  expect(activity.isActive()).toBe(true);
  hidden = true;
  fire("visibilitychange");
  hidden = false;
  fire("visibilitychange");
  expect(activity.isActive()).toBe(false);
  const olderQuery = resolveCurrent;
  chromeWindowFocus(-1);
  await current(42, false);
  expect(activity.isActive()).toBe(false);
  olderQuery({ id: 42, focused: true });
  await Promise.resolve();
  expect(activity.isActive()).toBe(false);
  expect(changes).toEqual([false, true, false]);
  activity.dispose();
});

test("rejected query/missing window ID degrade to visibility-only; later valid focus query recovers", async () => {
  const activity = createPageActivity(browserPageEnvironment());
  expect(activity.isActive()).toBe(false);
  rejectCurrent(new Error("window unavailable"));
  await Promise.resolve();
  await Promise.resolve();
  expect(activity.isActive()).toBe(true);
  chromeWindowFocus(-1);
  await current(42, false);
  expect(activity.isActive()).toBe(false);
  fire("pageshow");
  await current(42, true);
  expect(activity.isActive()).toBe(true);
  chromeWindowFocus(11);
  await current(11, true);
  expect(activity.isActive()).toBe(true);
  fire("pageshow");
  await current(undefined as unknown as number, false);
  expect(activity.isActive()).toBe(true);
  activity.dispose();
});

test("window reparent and frozen pageshow re-query; newer query wins over older response", async () => {
  const activity = createPageActivity(browserPageEnvironment());
  await current(42, true);
  fire("pagehide");
  chromeWindowFocus(-1);
  fire("pageshow");
  expect(activity.isActive()).toBe(false);
  await current(57, true);
  expect(activity.isActive()).toBe(true);
  chromeWindowFocus(42);
  expect(activity.isActive()).toBe(false);
  const oldResolve = resolveCurrent;
  fire("visibilitychange");
  await current(57, true);
  expect(activity.isActive()).toBe(true);
  oldResolve({ id: 42, focused: false });
  await Promise.resolve();
  expect(activity.isActive()).toBe(true);
  activity.dispose();
});

test("standalone fallback uses focus/blur; extension without windows API uses visibility only", () => {
  Reflect.deleteProperty(globalThis, "chrome");
  const standalone = createPageActivity(browserPageEnvironment());
  fire("blur");
  expect(standalone.isActive()).toBe(false);
  fire("focus");
  expect(standalone.isActive()).toBe(true);
  standalone.dispose();
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {},
  });
  const extension = createPageActivity(browserPageEnvironment());
  fire("blur");
  expect(extension.isActive()).toBe(true);
  hidden = true;
  fire("visibilitychange");
  expect(extension.isActive()).toBe(false);
  extension.dispose();
});
