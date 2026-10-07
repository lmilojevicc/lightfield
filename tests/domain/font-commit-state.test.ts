/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  FontCommitState,
  fontTuple,
} from "../../src/domain/fonts/font-commit-state";
import { customFontTuple } from "../../src/domain/fonts/font-pairings";
import {
  DEFAULT_SETTINGS,
  createPatchOwnership,
  normalize,
  overlayOwnedPatch,
  ownPatch,
} from "../../src/domain/settings/schema";
import {
  createQueuedExclusiveRunner,
  mergeWriteSettingsPatch,
} from "../../src/services/settings-transactions";

const patch = customFontTuple("Fraunces", "Bricolage Grotesque");
describe("font-commit-state: durable tuple and sheet focus ownership", () => {
  for (const reject of [true, false])
    test(`Apply behind write lock / unrelated storage event / ${reject ? "reject" : "success"}`, async () => {
      let durable = normalize(DEFAULT_SETTINGS);
      let active = { ...durable };
      const originalFonts = fontTuple(active);
      const ownership = createPatchOwnership<typeof active>();
      // Pending typography must never participate in the active overlay.
      const pendingOwnership = createPatchOwnership<typeof active>();
      ownPatch(pendingOwnership, patch, "queued");
      const commit = new FontCommitState(patch);
      const runner = createQueuedExclusiveRunner();
      let release!: () => void;
      const blocker = runner(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      await Promise.resolve();
      const saving = mergeWriteSettingsPatch(
        {
          read: () => Promise.resolve(durable),
          write: (next) => {
            return Promise.resolve().then(() => {
              if (reject) throw Error("controlled rejection");
              durable = next;
              commit.observe(next); // Chrome's durable write echo before promise resolution.
            });
          },
        },
        patch,
        runner,
      );
      const settled = saving.then(
        () => true,
        () => false,
      );
      durable = {
        ...durable,
        weatherLocation: "Other tab",
        showWeatherLocation: true,
      };
      commit.observe(durable);
      active = overlayOwnedPatch(durable, ownership);
      expect(fontTuple(active)).toEqual(originalFonts);
      release();
      await blocker;
      const success = await settled;
      const fonts = success ? commit.savedTuple() : commit.failedTuple();
      if (fonts) active = { ...active, ...fonts };
      expect(fontTuple(active)).toEqual(reject ? originalFonts : patch);
      expect(active.weatherLocation).toBe("Other tab");
      expect(active.showWeatherLocation).toBe(true);
      expect(fontTuple(active)).toEqual(fontTuple(durable));
      // Cancel reads active settings, not the discarded submitted tuple.
      expect(active.fonts).toBe(durable.fonts);
    });
  test("external font event before write wins on failure, successful write supersedes it", () => {
    const commit = new FontCommitState(patch);
    const external = {
      ...fontTuple(DEFAULT_SETTINGS),
      fonts: "system" as const,
    };
    expect(commit.observe(external)).toBe(false);
    expect(commit.failedTuple()).toEqual(external);
    expect(commit.savedTuple()).toEqual(patch);
  });
  test("external font event after own durable echo wins over late successful callback", () => {
    const commit = new FontCommitState(patch);
    expect(commit.observe(patch)).toBe(true);
    const external = { ...patch, fonts: "serif" as const };
    expect(commit.observe(external)).toBe(false);
    expect(commit.savedTuple()).toEqual(external);
    expect(commit.failedTuple()).toEqual(external);
  });
  test("no storage echo on static fallback still commits successful tuple", () => {
    const commit = new FontCommitState(patch);
    expect(commit.savedTuple()).toEqual(patch);
    expect(commit.failedTuple()).toBeNull();
  });
});
