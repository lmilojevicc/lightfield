import type { SettingsPresentation } from "./settings-presentation";

/** One mounted surface fades out before its layout changes; translate composes with centering. */
export function createPresentationHandoff(
  panel: HTMLElement,
  commit: (mode: SettingsPresentation) => void | Promise<void>,
) {
  let animation: Animation | undefined;
  let revision = 0;
  let requested: SettingsPresentation | undefined;
  const easing = getComputedStyle(panel).getPropertyValue("--ease-out").trim();

  function clear() {
    animation?.cancel();
    animation = undefined;
    panel.style.removeProperty("opacity");
    panel.style.removeProperty("translate");
    // Firefox also needs the underlying rest style resolved before transitions return.
    getComputedStyle(panel).getPropertyValue("opacity");
    panel.removeAttribute("data-presentation-handoff");
  }
  function settle(mode = requested) {
    ++revision;
    if (!animation && !panel.hasAttribute("data-presentation-handoff")) {
      if (mode) void commit(mode);
      return;
    }
    animation?.cancel();
    animation = undefined;
    panel.setAttribute("data-presentation-handoff", "");
    panel.style.removeProperty("opacity");
    panel.style.removeProperty("translate");
    if (mode) void commit(mode);
    // Resolve the endpoint with competing CSS transitions still suppressed.
    getComputedStyle(panel).getPropertyValue("transform");
    panel.removeAttribute("data-presentation-handoff");
  }
  function request(mode: SettingsPresentation, instant: boolean) {
    requested = mode;
    if (instant) {
      panel.setAttribute("data-presentation-handoff", "");
      settle(mode);
      return;
    }
    // Read the rendered values before cancelling, including a partially completed arrival.
    const style = getComputedStyle(panel);
    const opacity = style.opacity;
    const translate = style.translate === "none" ? "0px" : style.translate;
    const generation = ++revision;
    clear();
    panel.setAttribute("data-presentation-handoff", "");
    panel.style.opacity = opacity;
    panel.style.translate = translate;
    animation = panel.animate(
      [
        { opacity, translate },
        { opacity: 0, translate },
      ],
      { duration: 60 * Number(opacity), easing, fill: "forwards" },
    );
    animation.onfinish = () => {
      if (generation !== revision) return;
      panel.style.opacity = "0";
      animation?.cancel();
      // Keep the panel hidden until the parent's section activity/visibility effects settle.
      const committed = commit(mode);
      const enter = () => {
        if (generation !== revision) return;
        const offset = mode === "drawer" ? "8px" : "-8px";
        panel.style.translate = offset;
        animation = panel.animate(
          [
            { opacity: 0, translate: offset },
            { opacity: 1, translate: "0px" },
          ],
          { duration: 140, easing, fill: "forwards" },
        );
        animation.onfinish = () => {
          if (generation === revision) clear();
        };
      };
      if (committed) void committed.then(enter);
      else enter();
    };
  }
  return {
    request,
    settle,
    destroy: () => {
      ++revision;
      clear();
    },
  };
}
