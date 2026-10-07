/** Motion projects aria-expanded; it never owns disclosure or collection state. */
export function createDisclosureMotion(reducedMotion: () => boolean) {
  const active = new Map<
    HTMLElement,
    { toggle: HTMLButtonElement; animation: Animation; overflow: string }
  >();

  function settle(body: HTMLElement, toggle: HTMLButtonElement) {
    const running = active.get(body);
    if (running) {
      active.delete(body);
      running.animation.onfinish = null;
      running.animation.oncancel = null;
      running.animation.cancel();
      body.style.overflow = running.overflow;
    }
    toggle.removeAttribute("data-disclosure-motion");
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    body.hidden = !expanded;
    body.inert = !expanded;
    if (expanded) body.removeAttribute("aria-hidden");
    else body.setAttribute("aria-hidden", "true");
  }

  function finishAll() {
    for (const [body, { toggle }] of active) settle(body, toggle);
  }

  function setExpanded(
    toggle: HTMLButtonElement,
    expanded: boolean,
    animate = false,
  ): boolean {
    const bodyId = toggle.getAttribute("aria-controls");
    const body = bodyId ? toggle.ownerDocument.getElementById(bodyId) : null;
    if (!body) return false;
    // Finish nested folds before measuring their owner, including closing folds.
    for (const [child, running] of active) {
      if (child !== body && body.contains(child)) settle(child, running.toggle);
    }
    const changed = toggle.getAttribute("aria-expanded") !== String(expanded);
    const canAnimate =
      animate &&
      changed &&
      !reducedMotion() &&
      typeof body.animate === "function" &&
      toggle.getClientRects().length > 0;
    const fromHeight =
      canAnimate && !body.hidden ? body.getBoundingClientRect().height : 0;
    const fromOpacity =
      canAnimate && !body.hidden ? Number(getComputedStyle(body).opacity) : 0;
    settle(body, toggle);
    if (!expanded && body.contains(toggle.ownerDocument.activeElement))
      toggle.focus({ preventScroll: true });
    if (canAnimate) toggle.setAttribute("data-disclosure-motion", "");
    toggle.setAttribute("aria-expanded", String(expanded));
    body.inert = !expanded;
    if (expanded) body.removeAttribute("aria-hidden");
    else body.setAttribute("aria-hidden", "true");
    if (!canAnimate) {
      settle(body, toggle);
      return true;
    }
    body.hidden = false;
    const style = getComputedStyle(body);
    const toHeight = expanded ? body.getBoundingClientRect().height : 0;
    const paddingTop = style.paddingTop;
    const paddingBottom = style.paddingBottom;
    const overflow = body.style.overflow;
    body.style.overflow = "clip";
    try {
      const animation = body.animate(
        [
          {
            height: `${String(fromHeight)}px`,
            opacity: fromOpacity,
            paddingTop: fromHeight ? paddingTop : "0px",
            paddingBottom: fromHeight ? paddingBottom : "0px",
          },
          {
            height: `${String(toHeight)}px`,
            opacity: expanded ? 1 : 0,
            paddingTop: expanded ? paddingTop : "0px",
            paddingBottom: expanded ? paddingBottom : "0px",
          },
        ],
        { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
      active.set(body, { toggle, animation, overflow });
      animation.onfinish = animation.oncancel = () => {
        settle(body, toggle);
      };
    } catch {
      body.style.overflow = overflow;
      settle(body, toggle);
    }
    return true;
  }

  return { setExpanded, finishAll };
}
