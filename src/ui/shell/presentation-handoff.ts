import type { SettingsPresentation } from "./settings-presentation";

type Box = Pick<DOMRect, "left" | "top" | "width" | "height">;

/** Natural target coordinates exclude the panel's own centering transform. */
export function presentationFlip(source: Box, target: Box) {
  return `translate(${String(source.left - target.left)}px, ${String(source.top - target.top)}px) scale(${String(source.width / target.width)}, ${String(source.height / target.height)})`;
}

/** One mounted surface: depart, commit invisibly, then transform the destination. */
export function createPresentationHandoff(
  panel: HTMLElement,
  commit: (mode: SettingsPresentation) => void | Promise<void>,
) {
  let animations: Animation[] = [];
  let frozen: HTMLElement[] = [];
  let revision = 0;
  let requested: SettingsPresentation | undefined;

  function cancel() {
    for (const animation of animations) animation.cancel();
    animations = [];
  }
  // Reversing during the staggered content fade must not snap visible text to the
  // morph rule's zero: hold each child's rendered opacity inline as the surface departs.
  function freezeContent() {
    if (!panel.hasAttribute("data-presentation-morph")) return;
    frozen = [];
    for (const child of Array.from(panel.children)) {
      const element = child as HTMLElement;
      element.style.opacity = getComputedStyle(element).opacity;
      frozen.push(element);
    }
  }
  function releaseContent() {
    for (const element of frozen) element.style.removeProperty("opacity");
    frozen = [];
  }
  function clear() {
    cancel();
    releaseContent();
    for (const property of ["opacity", "transform", "transform-origin"])
      panel.style.removeProperty(property);
    panel.removeAttribute("data-presentation-morph");
    // Resolve CSS rest values while competing transitions remain suppressed (Firefox).
    getComputedStyle(panel).getPropertyValue("transform");
    panel.removeAttribute("data-presentation-handoff");
  }
  function settle(mode = requested) {
    ++revision;
    panel.setAttribute("data-presentation-handoff", "");
    cancel();
    if (mode) void commit(mode);
    clear();
  }
  function request(mode: SettingsPresentation, instant: boolean) {
    requested = mode;
    if (instant) {
      settle(mode);
      return;
    }
    const source = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const opacity = style.opacity;
    const transform = style.transform;
    const origin = style.transformOrigin;
    const generation = ++revision;
    // Freeze the rendered mid-flight box before cancelling; reversal never snaps to rest.
    panel.setAttribute("data-presentation-handoff", "");
    panel.style.opacity = opacity;
    panel.style.transform = transform;
    panel.style.transformOrigin = origin;
    freezeContent();
    cancel();
    const outgoing = panel.animate([{ opacity }, { opacity: 0 }], {
      duration: 90 * Number(opacity),
      easing: "ease-in",
      fill: "forwards",
    });
    animations.push(outgoing);
    outgoing.onfinish = () => {
      if (generation !== revision) return;
      panel.style.opacity = "0";
      cancel();
      panel.setAttribute("data-presentation-morph", "");
      const committed = commit(mode);
      const enter = () => {
        if (generation !== revision) return;
        panel.style.transform = "none";
        const target = panel.getBoundingClientRect();
        panel.style.transformOrigin = "0 0";
        panel.style.transform = presentationFlip(source, target);
        const geometry = panel.animate(
          [
            { transform: panel.style.transform },
            {
              transform:
                mode === "drawer"
                  ? "translate(0px, 0px) scale(1, 1)"
                  : "translate(-50%, -50%) scale(1, 1)",
            },
          ],
          {
            duration: 160,
            easing: "cubic-bezier(.22,1,.36,1)",
            fill: "forwards",
          },
        );
        const surface = panel.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 130,
          easing: "ease-out",
          fill: "forwards",
        });
        animations.push(geometry, surface);
        const children = Array.from(panel.children);
        let remaining = children.length;
        for (const child of children) {
          const content = child.animate([{ opacity: 0 }, { opacity: 1 }], {
            delay: 96,
            duration: 120,
            easing: "ease-out",
            fill: "both",
          });
          animations.push(content);
          content.onfinish = () => {
            if (generation === revision && --remaining === 0) clear();
          };
        }
        geometry.onfinish = () => {
          if (generation !== revision) return;
          geometry.cancel();
          panel.style.removeProperty("transform");
          panel.style.removeProperty("transform-origin");
          getComputedStyle(panel).getPropertyValue("transform");
          if (!children.length) clear();
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
