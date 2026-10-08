interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Animate bounds, not text scale; the existing panel and content keep their identity. */
export function createPresentationMotion(
  panel: HTMLElement,
  reducedMotion: () => boolean,
) {
  let animation: Animation | undefined;
  let revision = 0;
  function cancel() {
    revision++;
    animation?.cancel();
    animation = undefined;
    panel.removeAttribute("data-presentation-motion");
  }
  function capture(): { revision: number; geometry: Geometry } {
    const rect = panel.getBoundingClientRect();
    cancel();
    panel.setAttribute("data-presentation-motion", "");
    return { revision, geometry: rect };
  }
  function play(from: ReturnType<typeof capture>) {
    if (from.revision !== revision) return;
    if (reducedMotion()) {
      cancel();
      return;
    }
    const to = panel.getBoundingClientRect();
    const frame = (rect: Geometry): Keyframe => ({
      top: `${String(rect.top)}px`,
      left: `${String(rect.left)}px`,
      right: "auto",
      width: `${String(rect.width)}px`,
      height: `${String(rect.height)}px`,
      maxWidth: "none",
      maxHeight: "none",
      transform: "none",
      opacity: 1,
    });
    animation = panel.animate([frame(from.geometry), frame(to)], {
      duration: 180,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
    animation.onfinish = () => {
      if (from.revision === revision) cancel();
    };
  }
  return { capture, play, cancel };
}
