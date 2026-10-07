import {
  FontCommitState,
  fontTuple,
  sameFontTuple,
  type FontTuple,
} from "../domain/fonts/font-commit-state";
import { customFontTuple, fontPreset } from "../domain/fonts/font-pairings";
import {
  FontRequestOwner,
  loadCustomFont,
  type FontEnvironment,
  type LoadedFont,
} from "./custom-font-loading";
import type { FontSession, FontSnapshot, FontPreview } from "./contracts";
import type { NativeSettingsSession } from "./settings-session";
import type { PageActivity } from "../platform/page-activity";
export class NativeFontSession implements FontSession {
  private activeOwner = new FontRequestOwner();
  private saveOwner = new FontRequestOwner();
  private previewOwner = new FontRequestOwner();
  private previews = new Set<NonNullable<typeof this.active>>();
  private pendingSaves = new Set<NonNullable<typeof this.active>>();
  private active: { display: LoadedFont; body: LoadedFont } | null = null;
  private activeTuple: FontTuple | null = null;
  private saveSequence = 0;
  private pendingSave: number | null = null;
  private snapshot: FontSnapshot = {
    state: "idle",
    error: null,
    display: null,
    body: null,
  };
  private commit: FontCommitState | null = null;
  private disposed = false;
  private listeners = new Set<(snapshot: FontSnapshot) => void>();
  private unsettings: () => void;
  private unactivity: () => void;
  private last: FontTuple;
  private initialized = false;
  constructor(
    private readonly settings: NativeSettingsSession,
    private readonly env: FontEnvironment,
    private readonly activity: PageActivity,
  ) {
    this.last = fontTuple(settings.current().durable);
    this.unsettings = settings.subscribe((snapshot) => {
      if (!snapshot.ready) return;
      const tuple = fontTuple(snapshot.durable);
      this.commit?.observe(tuple);
      if (!sameFontTuple(tuple, this.last)) {
        this.last = tuple;
        if (this.initialized && !this.commit) void this.reconcile();
      }
    });
    this.unactivity = activity.subscribe((active) => {
      if (!active) {
        this.activeOwner.cancel();
        this.previewOwner.cancel();
      } else void this.reconcile();
    });
  }
  current(): FontSnapshot {
    return structuredClone(this.snapshot);
  }
  subscribe(listener: (snapshot: FontSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(): void {
    if (!this.disposed)
      for (const listener of this.listeners) listener(this.current());
  }
  private disposePair(pair: typeof this.active): void {
    pair?.display.dispose();
    pair?.body.dispose();
  }
  private activate(
    pair: NonNullable<typeof this.active>,
    tuple: FontTuple,
  ): void {
    const previous = this.active;
    this.active = pair;
    this.activeTuple = fontTuple(tuple);
    this.snapshot = {
      state: "ready",
      error: null,
      display: pair.display.family,
      body: pair.body.family,
    };
    this.emit();
    this.disposePair(previous);
  }
  private async load(
    tuple: FontTuple,
    signal: AbortSignal,
  ): Promise<NonNullable<typeof this.active>> {
    const names =
      tuple.fonts === "custom"
        ? [tuple.customDisplayFont, tuple.customBodyFont]
        : [
            fontPreset(tuple.fonts).display.name,
            fontPreset(tuple.fonts).body.name,
          ];
    const results = await Promise.all([
      loadCustomFont(names[0] ?? "", "display", signal, this.env),
      loadCustomFont(names[1] ?? "", "body", signal, this.env),
    ]);
    const display = results[0],
      body = results[1];
    if (display.state !== "ready" || body.state !== "ready") {
      if (display.state === "ready") display.font.dispose();
      if (body.state === "ready") body.font.dispose();
      throw new Error(
        display.state === "unavailable"
          ? display.message
          : body.state === "unavailable"
            ? body.message
            : "Font unavailable.",
      );
    }
    return { display: display.font, body: body.font };
  }
  retry(): Promise<void> {
    return this.reconcile(true);
  }
  private async reconcile(force = false): Promise<void> {
    if (
      this.disposed ||
      this.commit ||
      !this.activity.isActive() ||
      !this.settings.current().ready
    )
      return;
    this.initialized = true;
    const tuple = fontTuple(this.settings.current().durable);
    if (
      !force &&
      this.active &&
      this.activeTuple &&
      sameFontTuple(tuple, this.activeTuple)
    ) {
      if (this.snapshot.state === "loading") {
        this.snapshot = { ...this.snapshot, state: "ready", error: null };
        this.emit();
      }
      return;
    }
    const request = this.activeOwner.begin();
    this.snapshot = { ...this.snapshot, state: "loading", error: null };
    this.emit();
    try {
      const pair = await this.load(tuple, request.signal);
      if (
        !request.current() ||
        !sameFontTuple(tuple, this.settings.current().durable)
      ) {
        this.disposePair(pair);
        return;
      }
      this.authorizePair(pair);
      this.activate(pair, tuple);
    } catch (error) {
      if (!request.current()) return;
      this.snapshot = {
        ...this.snapshot,
        state: "error",
        error: error instanceof Error ? error.message : "Font unavailable.",
      };
      this.emit();
    }
  }
  private authorizePair(pair: NonNullable<typeof this.active>): void {
    if (
      (pair.display.family.source === "google" ||
        pair.body.family.source === "google") &&
      !this.env.remoteAllowed()
    ) {
      this.disposePair(pair);
      throw new Error("Remote fonts require consent.");
    }
  }
  private waitForActivity(signal: AbortSignal): Promise<void> {
    if (this.activity.isActive()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const finish = (active: boolean) => {
        unsubscribe();
        signal.removeEventListener("abort", abort);
        if (active) resolve();
        else reject(new DOMException("Cancelled", "AbortError"));
      };
      const abort = () => {
        finish(false);
      };
      unsubscribe = this.activity.subscribe((active) => {
        if (active) finish(true);
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else if (this.activity.isActive()) finish(true);
    });
  }
  async preview(
    display: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<FontPreview> {
    if (this.disposed) throw new Error("Font session disposed.");
    const tuple = customFontTuple(display, body);
    const request = this.previewOwner.begin();
    const abort = () => {
      if (request.current()) this.previewOwner.cancel();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      await this.waitForActivity(request.signal);
      const pair = await this.load(tuple, request.signal);
      if (!request.current()) {
        this.disposePair(pair);
        throw new Error("Font preview superseded.");
      }
      this.authorizePair(pair);
      this.previews.add(pair);
      let released = false;
      return {
        display: structuredClone(pair.display.family),
        body: structuredClone(pair.body.family),
        dispose: () => {
          if (released) return;
          released = true;
          this.previews.delete(pair);
          this.disposePair(pair);
        },
      };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  save(display: string, body: string): Promise<void> {
    return this.preset(customFontTuple(display, body));
  }
  async preset(tuple: FontTuple): Promise<void> {
    if (this.disposed) throw new Error("Font session disposed.");
    const sequence = ++this.saveSequence;
    this.pendingSave = sequence;
    let submitted: FontCommitState | null = null;
    this.activeOwner.cancel();
    const request = this.saveOwner.begin();
    let pending: typeof this.active = null;
    this.snapshot = { ...this.snapshot, state: "loading", error: null };
    this.emit();
    try {
      pending = await this.load(tuple, request.signal);
      this.pendingSaves.add(pending);
      if (!request.current()) throw new Error("Font request superseded.");
      const commit = new FontCommitState(tuple);
      submitted = this.commit = commit;
      const verified = pending;
      await this.settings.write(tuple, false, undefined, undefined, () => {
        if (!request.current()) throw new Error("Font request superseded.");
        this.authorizePair(verified);
      });
      const saved = commit.savedTuple();
      if (
        request.current() &&
        sameFontTuple(saved, tuple) &&
        sameFontTuple(this.settings.current().durable, tuple)
      ) {
        this.authorizePair(pending);
        this.activate(pending, tuple);
        this.pendingSaves.delete(pending);
        pending = null;
      } else throw new Error("Font selection changed in another tab.");
    } catch (error) {
      if (request.current()) {
        this.snapshot = {
          ...this.snapshot,
          state: "error",
          error:
            error instanceof Error ? error.message : "Could not save fonts.",
        };
        this.emit();
      }
      throw error;
    } finally {
      if (pending) this.pendingSaves.delete(pending);
      this.disposePair(pending);
      if (this.pendingSave === sequence) this.pendingSave = null;
      if (submitted && this.commit === submitted) this.commit = null;
      // Submitted persistence outlives draft cancellation, but cannot disturb a newer save.
      if (this.pendingSave === null && !this.commit) await this.reconcile();
    }
  }
  cancel(): void {
    this.saveOwner.cancel();
    this.previewOwner.cancel();
    if (!this.commit) void this.reconcile();
  }
  authorizationChanged(): void {
    this.activeOwner.cancel();
    this.cancel();
    for (const pending of this.pendingSaves) this.disposePair(pending);
    for (const preview of this.previews) this.disposePair(preview);
    this.previews.clear();
  }
  dispose(): void {
    this.disposed = true;
    this.activeOwner.cancel();
    this.cancel();
    this.unsettings();
    this.unactivity();
    this.disposePair(this.active);
    this.active = null;
    this.listeners.clear();
    for (const preview of this.previews) this.disposePair(preview);
    this.previews.clear();
    for (const pending of this.pendingSaves) this.disposePair(pending);
    this.pendingSaves.clear();
  }
}
