import {
  overlayOwnedPatch,
  type PatchOwnership,
  type Settings,
  type SettingsWriteObserver,
} from "./schema";
import { IMAGE_CONFLICT } from "../../shared/local-image";

const BACKGROUND_VIEW_FIELDS = [
  "background",
  "backgroundOverrides",
  "backgroundRevision",
  "localImage",
] as const;
function tuple(settings: Settings): string {
  return JSON.stringify(BACKGROUND_VIEW_FIELDS.map((key) => settings[key]));
}
export interface BackgroundIntent {
  revision: number;
  epoch: number;
}
/** Observe and reconcile in one step: a reread may consume an external revision
 * before its event arrives. Never overlay ownership invalidated by that revision. */
export function reconcileBackgroundPublication(
  durable: Settings,
  owner: BackgroundOwnership,
  fields: PatchOwnership<Settings>,
) {
  const observation = owner.observe(durable);
  let ownershipCleared = false;
  if (observation === "external") {
    for (const key of BACKGROUND_VIEW_FIELDS) {
      if (fields.fields[key]) ownershipCleared = true;
      Reflect.deleteProperty(fields.fields, key);
    }
  }
  const incoming = overlayOwnedPatch(durable, fields);
  incoming.backgroundRevision = durable.backgroundRevision;
  return { observation, incoming, ownershipCleared };
}
/** Per-document ownership only. All writers share the settings Web Lock. A prepared
 * exact tuple can echo before set() resolves; only strict acknowledgement adds an
 * edge that a later same-document intent may cross. An external revision breaks
 * the chain. Unrelated settings are deliberately absent from echo classification.
 */
export class BackgroundOwnership {
  private epoch = 0;
  private generation = 0;
  private observedRevision: number;
  private own = new Map<
    number,
    { key: string; from: number; acknowledged: boolean }
  >();
  constructor(initial: Settings) {
    this.observedRevision = initial.backgroundRevision;
  }
  intent(revision: number): BackgroundIntent {
    return { revision, epoch: this.epoch };
  }
  resolve(intent: BackgroundIntent): number {
    if (intent.epoch !== this.epoch) throw new Error(IMAGE_CONFLICT);
    let revision = intent.revision;
    for (const [to, write] of this.own) {
      if (write.acknowledged && write.from === revision && to > revision)
        revision = to;
    }
    return revision;
  }
  observer(intent: BackgroundIntent): SettingsWriteObserver {
    return {
      patch: (patch) => ({
        ...patch,
        backgroundRevision: this.resolve(intent),
      }),
      prepared: (current, next) => {
        this.prepared(current, next);
      },
      acknowledged: (next) => {
        this.acknowledged(next);
      },
      failed: (next) => {
        this.failed(next);
      },
    };
  }
  prepared(current: Settings, next: Settings): void {
    if (next.backgroundRevision !== current.backgroundRevision)
      this.own.set(next.backgroundRevision, {
        key: tuple(next),
        from: current.backgroundRevision,
        acknowledged: false,
      });
  }
  acknowledged(next: Settings): void {
    const write = this.own.get(next.backgroundRevision);
    if (write?.key === tuple(next)) write.acknowledged = true;
    this.observedRevision = Math.max(
      this.observedRevision,
      next.backgroundRevision,
    );
  }
  failed(next: Settings): void {
    const write = this.own.get(next.backgroundRevision);
    if (write?.key === tuple(next) && !write.acknowledged)
      this.own.delete(next.backgroundRevision);
  }
  observe(next: Settings): "own" | "external" | "stale" | "current" {
    if (next.backgroundRevision < this.observedRevision) return "stale";
    const own = this.own.get(next.backgroundRevision)?.key === tuple(next);
    if (own) {
      this.observedRevision = next.backgroundRevision;
      return "own";
    }
    if (next.backgroundRevision === this.observedRevision) return "current";
    this.observedRevision = next.backgroundRevision;
    this.epoch++;
    this.invalidate();
    this.own.clear();
    return "external";
  }
  invalidate(): void {
    this.generation++;
  }
  read(): number {
    return ++this.generation;
  }
  fresh(generation: number, next: Settings): boolean {
    return (
      generation === this.generation &&
      next.backgroundRevision >= this.observedRevision
    );
  }
}
