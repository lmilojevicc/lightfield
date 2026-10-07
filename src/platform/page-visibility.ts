import type { PageActivityEnvironment } from "./page-activity";
export interface PageVisibility {
  isVisible(): boolean;
  subscribe(listener: (visible: boolean) => void): () => void;
  dispose(): void;
}
/** Image mutation ownership depends on visibility/pagehide, never browser-window focus. */
export function createPageVisibility({
  document,
  window,
}: PageActivityEnvironment): PageVisibility {
  let shown = true;
  let visible = !document.hidden;
  const listeners = new Set<(visible: boolean) => void>();
  const update = () => {
    const next = shown && !document.hidden;
    if (next === visible) return;
    visible = next;
    for (const listener of listeners) listener(visible);
  };
  const hide = () => {
    shown = false;
    update();
  };
  const show = () => {
    shown = true;
    update();
  };
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  return {
    isVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      listeners.clear();
    },
  };
}
