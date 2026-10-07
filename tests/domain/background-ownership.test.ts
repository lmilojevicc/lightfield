import { describe, expect, test } from "bun:test";
import {
  BackgroundOwnership,
  reconcileBackgroundPublication,
} from "../../src/domain/settings/background-ownership";
import {
  DEFAULT_SETTINGS,
  mergeSettingsPatch,
  createPatchOwnership,
  ownPatch,
  overlayOwnedPatch,
  settleOwnedPatch,
  failedOwnedPatch,
  persistenceStatusSnapshot,
  type Settings,
} from "../../src/domain/settings/schema";
import {
  createQueuedExclusiveRunner,
  mergeWriteSettingsPatch,
} from "../../src/services/settings-transactions";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
describe("background publication reconciliation", () => {
  for (const unrelatedFailure of [false, true])
    test(`reread consumes external before current event; unrelated failure=${String(unrelatedFailure)}`, () => {
      const initial = { ...DEFAULT_SETTINGS, background: "ink" as const };
      const owner = new BackgroundOwnership(initial),
        fields = createPatchOwnership<Settings>(),
        fonts = createPatchOwnership<Settings>();
      const failed = ownPatch(
        fields,
        {
          background: "ink",
          backgroundOverrides: { ink: { opacity: 0.7 } },
          backgroundRevision: 0,
        },
        "failed",
      );
      if (unrelatedFailure)
        ownPatch(fields, { weatherLocation: "Keep failed location" }, "failed");
      const font = ownPatch(fonts, { fonts: "grotesque" }, "in-flight");
      const fontBefore = structuredClone(fonts);
      const external = mergeSettingsPatch(initial, { background: "none" });
      const read = owner.read();
      expect(owner.fresh(read, external)).toBe(true);
      const reread = reconcileBackgroundPublication(external, owner, fields);
      expect(reread.observation).toBe("external");
      expect(reread.ownershipCleared).toBe(true);
      expect(reread.incoming.background).toBe("none");
      expect(reread.incoming.backgroundOverrides).toEqual(
        external.backgroundOverrides,
      );
      expect(failedOwnedPatch(fields)).toEqual(
        unrelatedFailure ? { weatherLocation: "Keep failed location" } : {},
      );
      expect(persistenceStatusSnapshot(fields, false).status).toBe(
        unrelatedFailure ? "error" : "idle",
      );
      // A late failed callback must not recreate the removed fields or Retry.
      settleOwnedPatch(fields, failed, false);
      const delayed = reconcileBackgroundPublication(external, owner, fields);
      expect(delayed.observation).toBe("current");
      expect(delayed.ownershipCleared).toBe(false);
      expect(delayed.incoming.background).toBe("none");
      expect(delayed.incoming.weatherLocation).toBe(
        unrelatedFailure ? "Keep failed location" : external.weatherLocation,
      );
      expect(fonts).toEqual(fontBefore);
      expect(fonts.fields.fonts?.revision).toBe(font.revisions.fonts);
      expect(persistenceStatusSnapshot(fonts, false).status).toBe("saving");
    });
  for (const phase of ["dirty", "queued", "in-flight", "failed"] as const)
    test(`own echo preserves ${phase} local intent`, () => {
      const initial = { ...DEFAULT_SETTINGS, background: "none" as const },
        owner = new BackgroundOwnership(initial),
        fields = createPatchOwnership<Settings>();
      const own = mergeSettingsPatch(initial, { background: "ink" });
      owner.prepared(initial, own);
      const queued = ownPatch(
          fields,
          { background: "waves", backgroundRevision: 0 },
          phase,
        ),
        intent = owner.intent(0);
      expect(
        reconcileBackgroundPublication(own, owner, fields).observation,
      ).toBe("own");
      expect(fields.fields.background?.revision).toBe(
        queued.revisions.background,
      );
      expect(
        reconcileBackgroundPublication(own, owner, fields).incoming.background,
      ).toBe("waves");
      owner.acknowledged(own);
      expect(owner.resolve(intent)).toBe(1);
      const external = mergeSettingsPatch(own, { background: "none" });
      expect(
        reconcileBackgroundPublication(external, owner, fields).incoming
          .background,
      ).toBe("none");
      expect(() => owner.resolve(intent)).toThrow("another tab");
      expect(failedOwnedPatch(fields)).toEqual({});
    });
});
describe("background ownership under the shared settings lock", () => {
  for (const echoFirst of [true, false])
    test(`successive slider writes: ${echoFirst ? "echo before ack" : "ack before echo"}`, async () => {
      let durable: Settings = { ...DEFAULT_SETTINGS, background: "none" };
      const owner = new BackgroundOwnership(durable),
        fields = createPatchOwnership<Settings>();
      const run = createQueuedExclusiveRunner(),
        held = deferred(),
        started = deferred();
      const first = ownPatch(fields, {
        background: "ink",
        backgroundRevision: 0,
      });
      const firstIntent = owner.intent(0);
      let firstCommit!: Settings,
        calls = 0;
      const store = {
        read: () => Promise.resolve(durable),
        write: async (next: Settings) => {
          if (++calls === 1) {
            firstCommit = next;
            started.resolve();
            await held.promise;
            durable = next;
            if (echoFirst) expect(owner.observe(next)).toBe("own");
          } else durable = next;
        },
      };
      const a = mergeWriteSettingsPatch(
        store,
        first.patch,
        run,
        owner.observer(firstIntent),
      );
      await started.promise;
      const second = ownPatch(fields, {
        background: "waves",
        backgroundRevision: 0,
      });
      const secondIntent = owner.intent(0);
      held.resolve();
      await a;
      settleOwnedPatch(fields, first, true);
      if (!echoFirst) expect(owner.observe(firstCommit)).toBe("own");
      expect(overlayOwnedPatch(durable, fields).background).toBe("waves");
      const b = await mergeWriteSettingsPatch(
        store,
        second.patch,
        run,
        owner.observer(secondIntent),
      );
      expect(b.background).toBe("waves");
      expect(b.backgroundRevision).toBe(2);
      expect(owner.observe(firstCommit)).toBe("stale");
    });
  for (const source of ["none", "ink"] as const)
    for (const succeeds of [true, false])
      test(`image commit ${succeeds ? "ack" : "failure"}, newer ${source} intent`, async () => {
        let durable = { ...DEFAULT_SETTINGS };
        const owner = new BackgroundOwnership(durable);
        const image = mergeSettingsPatch(durable, {
          background: "local-image",
        });
        owner.prepared(durable, image);
        const intent = owner.intent(0),
          view = owner.read();
        owner.invalidate();
        if (succeeds) {
          durable = image;
          expect(owner.observe(image)).toBe("own");
          owner.acknowledged(image);
        } else owner.failed(image);
        expect(owner.fresh(view, durable)).toBe(false);
        const next = await mergeWriteSettingsPatch(
          {
            read: () => Promise.resolve(durable),
            write: (s) => {
              return Promise.resolve().then(() => {
                durable = s;
              });
            },
          },
          { background: source, backgroundRevision: 0 },
          createQueuedExclusiveRunner(),
          owner.observer(intent),
        );
        expect(next.background).toBe(source);
        expect(next.backgroundRevision).toBe(
          succeeds ? 2 : source === DEFAULT_SETTINGS.background ? 0 : 1,
        );
      });
  test("external revision invalidates queued same-tab intents; strict concurrency remains", () => {
    return Promise.resolve().then(() => {
      const initial = { ...DEFAULT_SETTINGS, background: "none" as const },
        owner = new BackgroundOwnership(initial),
        intent = owner.intent(0);
      const own = mergeSettingsPatch(initial, { background: "ink" });
      owner.prepared(initial, own);
      owner.acknowledged(own);
      const external = mergeSettingsPatch(own, { background: "waves" });
      expect(owner.observe(external)).toBe("external");
      expect(() => owner.resolve(intent)).toThrow("another tab");
      expect(() =>
        mergeSettingsPatch(external, {
          background: "none",
          backgroundRevision: 0,
        }),
      ).toThrow("another tab");
      expect(owner.observe(own)).toBe("stale");
    });
  });
  for (const path of ["retry", "post-import"])
    for (const source of ["none", "local-image"] as const)
      test(`${path} held read cannot resurrect after external ${source}`, () => {
        const initial = { ...DEFAULT_SETTINGS },
          owner = new BackgroundOwnership(initial);
        const read = owner.read();
        const external = {
          ...initial,
          background: source,
          backgroundRevision: 1,
        };
        owner.observe(external);
        expect(owner.fresh(read, initial)).toBe(false);
        const latest = owner.read();
        expect(owner.fresh(latest, initial)).toBe(false);
        expect(owner.fresh(latest, external)).toBe(true);
        owner.invalidate();
        expect(owner.fresh(latest, external)).toBe(false);
      });
  test("unrelated typography/theme echo doesn't invalidate background read or intent", () => {
    const initial = { ...DEFAULT_SETTINGS },
      owner = new BackgroundOwnership(initial),
      intent = owner.intent(0),
      read = owner.read();
    const next = {
      ...initial,
      theme: "ivory",
      fonts: "modern" as Settings["fonts"],
    };
    expect(owner.observe(next)).toBe("current");
    expect(owner.fresh(read, next)).toBe(true);
    expect(owner.resolve(intent)).toBe(0);
  });
});
