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
