import type { Settings } from "../../domain/settings/schema";
import {
  getBackgroundDescriptor,
  effectiveBackgroundConfig,
  effectiveImageFilter,
  PAPER_IMAGE_FILTERS,
  isPaperImageFilter,
} from "../../shared/background-metadata";

export function selectedControls(settings: Settings) {
  const filter =
    settings.background === "local-image" ? settings.localImage.filter : "none";
  return isPaperImageFilter(filter)
    ? PAPER_IMAGE_FILTERS[filter]
    : getBackgroundDescriptor(settings.background);
}
export function controlValues(settings: Settings) {
  const filter =
    settings.background === "local-image" ? settings.localImage.filter : "none";
  return isPaperImageFilter(filter)
    ? effectiveImageFilter(filter, settings.localImage.filterOverrides)
    : effectiveBackgroundConfig(
        settings.background,
        settings.backgroundOverrides,
      );
}
export function tuningScope(settings: Settings): string | null {
  if (
    !selectedControls(settings).controls.length ||
    settings.background === "none"
  )
    return null;
  if (settings.background === "local-image") {
    const { assetId, filter } = settings.localImage;
    return assetId && filter !== "none"
      ? JSON.stringify(["local-image", assetId, filter])
      : null;
  }
  return settings.background;
}

/** Move the single Svelte-owned group; never instantiate a second form. */
export function relocate(
  node: HTMLElement,
  destination: HTMLElement,
  before?: Node | null,
) {
  if (
    node.parentElement === destination &&
    (before === undefined || before === node)
  )
    return;
  const active = node.ownerDocument.activeElement;
  const focused =
    active instanceof HTMLElement && node.contains(active) ? active : null;
  const mover = destination as HTMLElement & {
    moveBefore?: (node: Node, before: Node | null) => void;
  };
  if (mover.moveBefore && node.isConnected && destination.isConnected)
    mover.moveBefore(node, before ?? null);
  else if (before !== undefined) destination.insertBefore(node, before);
  else destination.append(node);
  focused?.focus({ preventScroll: true });
}

/** Local fit/feedback/credit follow the tuner, with an exact home anchor. */
export function attachToTuner(node: HTMLElement, target: HTMLElement | null) {
  const marker = node.ownerDocument.createComment("Tuner attachment home");
  node.before(marker);
  function move(destination: HTMLElement | null) {
    if (destination) relocate(node, destination);
    else marker.after(node);
  }
  move(target);
  return {
    update: move,
    destroy() {
      marker.after(node);
      marker.remove();
    },
  };
}

/** Source puts Fit before the active filter group in the detached tuner. */
export function attachFitToTuner(
  node: HTMLElement,
  target: HTMLElement | null,
) {
  const attachment = attachToTuner(node, target);
  const position = (destination: HTMLElement | null) => {
    if (destination && destination.firstChild !== node)
      relocate(node, destination, destination.firstChild);
  };
  position(target);
  return {
    update(destination: HTMLElement | null) {
      attachment.update(destination);
      position(destination);
    },
    destroy() {
      attachment.destroy();
    },
  };
}
