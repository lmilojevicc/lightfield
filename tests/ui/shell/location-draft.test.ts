import { expect, test } from "bun:test";
import { createLocationDraft } from "../../../src/ui/shell/location-draft";
import type { SettingsPatch } from "../../../src/domain/settings/schema";
import { DEFAULT_SETTINGS } from "../../../src/domain/settings/schema";

test("city text claims native ownership before debounce, replaces only unsubmitted tickets, and blur commits once", async () => {
  const events: string[] = [],
    jobs: (() => void)[] = [];
  const draft = createLocationDraft(
    {
      stage(patch: SettingsPatch) {
        const text = patch.weatherLocation ?? "";
        events.push(`stage:${text}`);
        return {
          cancel() {
            events.push(`cancel:${text}`);
          },
          commit() {
            events.push(`commit:${text}`);
            return Promise.resolve(DEFAULT_SETTINGS);
          },
        };
      },
    },
    {
      setTimeout: ((done: () => void, ms?: number) => {
        expect(ms).toBe(450);
        jobs.push(done);
        return jobs.length;
      }) as typeof setTimeout,
      clearTimeout: () => {},
    },
  );
  draft.edit("London");
  draft.edit("Paris");
  expect(events).toEqual(["stage:London", "cancel:London", "stage:Paris"]);
  jobs[0]?.();
  expect(events).toHaveLength(3);
  await draft.flush();
  jobs.at(-1)?.();
  expect(events).toEqual([
    "stage:London",
    "cancel:London",
    "stage:Paris",
    "commit:Paris",
  ]);
  draft.dispose();
  expect(events.at(-1)).toBe("commit:Paris");
});

test("unmount cancels an unsubmitted claim; rejected durable work remains facade retry authority", async () => {
  let cancelled = 0,
    commits = 0;
  const draft = createLocationDraft({
    stage() {
      return {
        cancel() {
          cancelled++;
        },
        commit() {
          commits++;
          return Promise.reject(new Error("Couldn’t save changes."));
        },
      };
    },
  });
  draft.edit("London");
  draft.dispose();
  expect(cancelled).toBe(1);
  expect(commits).toBe(0);
  draft.edit("Paris");
  let error: unknown;
  try {
    await draft.flush();
  } catch (failure) {
    error = failure;
  }
  expect(error).toBeInstanceOf(Error);
  draft.dispose();
  expect(cancelled).toBe(1);
  expect(commits).toBe(1);
});
