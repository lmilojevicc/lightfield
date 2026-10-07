import { describe, expect, test } from "bun:test";
import { createNetworkConsent } from "../../../src/app/network-consent";
import type { Settings } from "../../../src/domain/settings/schema";

function fixture() {
  const durable: Pick<Settings, "fonts" | "showWeather"> = {
    fonts: "system",
    showWeather: false,
  };
  let requests = 0,
    notifications = 0,
    live = true;
  let grant: (value: boolean) => void = () => {
    throw new Error("Request not started");
  };
  const errors: unknown[] = [];
  const consent = createNetworkConsent({
    durable: () => durable,
    weatherEnabled: () => durable.showWeather,
    requestFonts() {
      requests++;
      return new Promise<boolean>((resolve) => {
        grant = resolve;
      });
    },
    notify() {
      notifications++;
    },
    alive: () => live,
    report(error) {
      errors.push(error);
    },
  });
  return {
    consent,
    durable,
    grant: (value: boolean) => {
      grant(value);
    },
    requests: () => requests,
    notifications: () => notifications,
    dispose() {
      live = false;
    },
    errors,
  };
}
describe("integration's sole network authorization owner", () => {
  test("fresh defaults are offline; optional permission starts synchronously from gesture", async () => {
    const f = fixture();
    expect(f.consent.fonts()).toBe(false);
    expect(f.consent.weather()).toBe(false);
    const work = f.consent.requestFonts();
    expect(f.requests()).toBe(1);
    expect(f.consent.fonts()).toBe(false);
    f.grant(true);
    expect(await work).toBe(true);
    expect(f.consent.fonts()).toBe(true);
    expect(f.notifications()).toBe(1);
    const repeat = f.consent.requestFonts();
    f.grant(true);
    await repeat;
    expect(f.notifications()).toBe(1);
  });
  test("denial and late unmounted grant never authorize network", async () => {
    const denied = fixture();
    const first = denied.consent.requestFonts();
    denied.grant(false);
    expect(await first).toBe(false);
    expect(denied.consent.fonts()).toBe(false);
    const late = fixture();
    const work = late.consent.requestFonts();
    late.dispose();
    late.grant(true);
    expect(await work).toBe(false);
    expect(late.notifications()).toBe(0);
  });
  test("existing durable opt-ins survive asynchronous initialization/reload without requests", () => {
    const f = fixture();
    f.durable.fonts = "custom";
    f.durable.showWeather = true;
    expect(f.consent.fonts()).toBe(true);
    expect(f.consent.weather()).toBe(true);
    expect(f.requests()).toBe(0);
    f.durable.showWeather = false;
    expect(f.consent.weather()).toBe(false);
    f.durable.fonts = "mono";
    expect(f.consent.fonts()).toBe(false);
  });
  test("permission errors are handled and never grant consent", async () => {
    const errors: unknown[] = [];
    const consent = createNetworkConsent({
      durable: () => ({ fonts: "system" }),
      weatherEnabled: () => false,
      requestFonts: () => Promise.reject(new Error("denied")),
      notify() {
        throw new Error("Must not notify");
      },
      alive: () => true,
      report(error) {
        errors.push(error);
      },
    });
    expect(await consent.requestFonts()).toBe(false);
    expect(errors).toHaveLength(1);
    expect(consent.fonts()).toBe(false);
  });
});
