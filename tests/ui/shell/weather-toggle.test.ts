import { expect, test } from "bun:test";
import { createWeatherToggle } from "../../../src/ui/shell/weather-toggle";
import { DEFAULT_SETTINGS } from "../../../src/domain/settings/schema";

test("auto-weather requests directly on gesture; a late grant cannot re-enable after disable", async () => {
  const events: string[] = [];
  let resolve: ((granted: boolean) => void) | undefined;
  const permission = new Promise<boolean>((done) => {
    resolve = done;
  });
  const toggle = createWeatherToggle({
    settings: {
      stage(patch) {
        const enabled = String(patch.showWeather);
        events.push(`stage:${enabled}`);
        return {
          cancel() {
            events.push(`cancel:${enabled}`);
          },
          commit() {
            events.push(`commit:${enabled}`);
            return Promise.resolve(DEFAULT_SETTINGS);
          },
        };
      },
    },
    requestLocation() {
      events.push("request");
      return permission;
    },
    consent(enabled) {
      events.push(`consent:${String(enabled)}`);
    },
  });
  const enable = toggle.set(true, true);
  expect(events).toEqual(["request", "consent:true", "stage:true"]);
  await toggle.set(false, true);
  resolve?.(true);
  await enable;
  expect(events).toEqual([
    "request",
    "consent:true",
    "stage:true",
    "cancel:true",
    "consent:false",
    "stage:false",
    "commit:false",
  ]);
});

test("manual city needs no permission and unmount cancels an unsubmitted automatic opt-in", async () => {
  let requests = 0,
    commits = 0,
    cancels = 0;
  let resolve: ((value: boolean) => void) | undefined;
  const permission = new Promise<boolean>((done) => {
    resolve = done;
  });
  const toggle = createWeatherToggle({
    settings: {
      stage() {
        return {
          cancel() {
            cancels++;
          },
          commit() {
            commits++;
            return Promise.resolve(DEFAULT_SETTINGS);
          },
        };
      },
    },
    requestLocation() {
      requests++;
      return permission;
    },
    consent() {},
  });
  await toggle.set(true, false);
  expect(requests).toBe(0);
  expect(commits).toBe(1);
  const pending = toggle.set(true, true);
  toggle.dispose();
  resolve?.(false);
  await pending;
  expect(requests).toBe(1);
  expect(commits).toBe(1);
  expect(cancels).toBe(1);
});

test("denied or failed auto access keeps feature opt-in so a manual city can recover", async () => {
  for (const failure of [false, new Error("Location denied")]) {
    let committed = false;
    const toggle = createWeatherToggle({
      settings: {
        stage: () => ({
          cancel() {},
          commit() {
            committed = true;
            return Promise.resolve(DEFAULT_SETTINGS);
          },
        }),
      },
      requestLocation: () =>
        failure instanceof Error
          ? Promise.reject(failure)
          : Promise.resolve(failure),
      consent() {},
    });
    await toggle.set(true, true).catch(() => {});
    expect(committed).toBe(true);
    toggle.dispose();
  }
});

test("obsolete location rejection does not publish an error after a newer manual enable", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<boolean>((_, no) => {
    reject = no;
  });
  const toggle = createWeatherToggle({
    settings: {
      stage: () => ({
        cancel() {},
        commit: () => Promise.resolve(DEFAULT_SETTINGS),
      }),
    },
    requestLocation: () => pending,
    consent() {},
  });
  const stale = toggle.set(true, true);
  await toggle.set(true, false);
  reject(new Error("obsolete"));
  await stale;
  toggle.dispose();
});
