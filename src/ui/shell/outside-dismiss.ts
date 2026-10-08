/** Dismiss at click time, using genuine matching pointer endpoints, not its common-ancestor target. */
export function listenOutsideDismiss(
  host: Window,
  surface: () => HTMLElement | null,
  close: () => void,
) {
  let gesture: {
    panel: HTMLElement;
    pointerId: number;
    released: boolean;
  } | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const outside = (panel: HTMLElement, event: Event) =>
    !event.composedPath().includes(panel);
  function reset() {
    gesture = null;
    clearTimeout(expiry);
    expiry = undefined;
  }
  const down = (event: PointerEvent) => {
    reset();
    const panel = surface();
    if (event.button === 0 && event.isPrimary && panel && outside(panel, event))
      gesture = { panel, pointerId: event.pointerId, released: false };
  };
  const up = (event: PointerEvent) => {
    if (
      !gesture ||
      gesture.released ||
      event.pointerId !== gesture.pointerId ||
      event.button !== 0 ||
      !event.isPrimary ||
      surface() !== gesture.panel ||
      !outside(gesture.panel, event)
    ) {
      reset();
      return;
    }
    gesture.released = true;
    // Native click follows pointerup synchronously; later activations cannot reuse it.
    expiry = setTimeout(reset, 0);
  };
  const click = (event: MouseEvent) => {
    const pointerId = (event as PointerEvent).pointerId;
    const dismiss =
      gesture?.released &&
      surface() === gesture.panel &&
      event.button === 0 &&
      event.detail > 0 &&
      (typeof pointerId !== "number" || pointerId === gesture.pointerId);
    reset();
    if (dismiss) close();
  };
  host.addEventListener("pointerdown", down, true);
  host.addEventListener("pointerup", up, true);
  host.addEventListener("pointercancel", reset, true);
  host.addEventListener("click", click, true);
  return {
    reset,
    destroy() {
      reset();
      host.removeEventListener("pointerdown", down, true);
      host.removeEventListener("pointerup", up, true);
      host.removeEventListener("pointercancel", reset, true);
      host.removeEventListener("click", click, true);
    },
  };
}
