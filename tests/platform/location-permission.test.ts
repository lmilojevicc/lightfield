import { expect, test } from "bun:test";
import { createLocationPermission } from "../../src/platform/location-permission";
import { createPermissions } from "../../src/platform/permissions";

function fixture() {
  const status = Object.assign(new EventTarget(), {
    state: "prompt",
  });
  let calls = 0;
  let success: PositionCallback | undefined;
  let failure: PositionErrorCallback | undefined;
  const port = createLocationPermission({
    permissions: {
      query: () => Promise.resolve(status),
    } as unknown as Permissions,
    geolocation: {
      getCurrentPosition(yes, no) {
        calls++;
        success = yes;
        failure = no ?? undefined;
      },
    } as Geolocation,
  });
  return {
    port,
    status,
    get calls() {
      return calls;
    },
    grant() {
      status.state = "granted";
      status.dispatchEvent(new Event("change"));
      success?.({
        coords: { latitude: 0, longitude: 0 },
      } as GeolocationPosition);
    },
    deny() {
      failure?.({ code: 1 } as GeolocationPositionError);
    },
  };
}

test("native query/startup never prompts; explicit gesture uses navigator, observes revoke and disposal", async () => {
  const h = fixture();
  const session = createPermissions(undefined, h.port);
  await session.refresh();
  expect(session.current().location).toBe(false);
  expect(h.calls).toBe(0);
  const pending = session.request("location");
  expect(h.calls).toBe(1);
  h.grant();
  expect(await pending).toBe(true);
  expect(session.current().location).toBe(true);
  let revoked = 0;
  session.subscribeRevocation(() => {
    revoked++;
  });
  h.status.state = "denied";
  h.status.dispatchEvent(new Event("change"));
  expect(revoked).toBe(1);
  expect(session.current().location).toBe(false);
  const stale = session.request("location");
  session.dispose();
  h.grant();
  expect(await stale).toBe(false);
  expect(session.current().location).toBe(false);
});

test("native denial is actionable and successful retry clears it", async () => {
  const h = fixture();
  const session = createPermissions(undefined, h.port);
  await session.refresh();
  const denied = session.request("location");
  h.deny();
  await denied.catch((error: unknown) => {
    expect(error instanceof Error ? error.message : "").toContain(
      "Location access denied",
    );
  });
  expect(session.current().error).toContain("enter a city");
  const retry = session.request("location");
  h.grant();
  expect(await retry).toBe(true);
  expect(session.current().error).toBeNull();
  session.dispose();
});

for (const granted of [true, false])
  test(`native location ${granted ? "grant" : "revocation"} replaces pending Fonts query without prompting`, async () => {
    const h = fixture();
    h.status.state = granted ? "prompt" : "granted";
    let hold = false;
    let resolveFonts!: (allowed: boolean) => void;
    const fonts = new Promise<boolean>((resolve) => {
      resolveFonts = resolve;
    });
    let queries = 0;
    const session = createPermissions(
      {
        contains: () => {
          queries++;
          return hold ? fonts : Promise.resolve(false);
        },
        request: () =>
          Promise.reject(new Error("No unsolicited extension request")),
        onAdded: { addListener() {}, removeListener() {} },
        onRemoved: { addListener() {}, removeListener() {} },
      },
      h.port,
    );
    await session.refresh();
    let revoked = 0;
    session.subscribeRevocation(() => {
      revoked++;
    });
    hold = true;
    const pending = session.refresh();
    h.status.state = granted ? "granted" : "denied";
    h.status.dispatchEvent(new Event("change"));
    expect(session.current().location).toBe(granted);
    expect(revoked).toBe(granted ? 0 : 1);
    expect(queries).toBe(3);
    resolveFonts(true);
    await pending;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(session.current().fonts).toBe(true);
    expect(session.current().location).toBe(granted);
    expect(h.calls).toBe(0);
    session.dispose();
  });
