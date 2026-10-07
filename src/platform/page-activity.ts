import type { BrowserNamespace } from "./storage/browser-storage";
export interface PageActivityEnvironment {
  document: Pick<
    Document,
    "hidden" | "hasFocus" | "addEventListener" | "removeEventListener"
  >;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  extension?: BrowserNamespace;
}
export interface PageActivity {
  isActive(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}

export interface OwnedPageActivity extends PageActivity {
  dispose(): void;
}

/** An omnibox-focused tab is active: DOM focus is not browser-window focus. */
export function createPageActivity(
  env: PageActivityEnvironment,
): OwnedPageActivity {
  const listeners = new Set<(active: boolean) => void>();
  const { document, window } = env;
  const windows = env.extension?.windows;
  const windowApi =
    windows &&
    typeof windows.getCurrent === "function" &&
    windows.onFocusChanged;
  let disposed = false;
  let focused = windowApi ? false : !env.extension ? document.hasFocus() : true;
  let pageShown = true;
  let active = !document.hidden && focused;
  let ownWindowId: number | undefined;
  let lastFocusedId: number | undefined;
  let focusVersion = 0;
  let queryVersion = 0;
  const notify = () => {
    const next = pageShown && !document.hidden && focused;
    if (disposed || next === active) return;
    active = next;
    for (const listener of [...listeners]) listener(active);
  };
  const onVisibility = () => {
    if (!document.hidden && windowApi) {
      focused = false;
      requestCurrent();
    }
    notify();
  };
  const onPageHide = () => {
    pageShown = false;
    notify();
  };
  const onPageShow = () => {
    pageShown = true;
    if (windowApi) {
      focused = false;
      requestCurrent();
    }
    notify();
  };
  const onWindowFocus = (id: number) => {
    lastFocusedId = id;
    focusVersion++;
    if (ownWindowId !== undefined) {
      focused = id === ownWindowId;
      notify();
    }
    // Chrome can move this tab to another window without recreating its document.
    if (!document.hidden && pageShown) requestCurrent(true);
  };
  const onFallbackFocus = () => {
    focused = true;
    notify();
  };
  const onFallbackBlur = () => {
    focused = false;
    notify();
  };
  function requestCurrent(fromFocusEvent = false) {
    if (!windowApi) return;
    const request = ++queryVersion;
    const versionAtRequest = focusVersion;
    const degrade = () => {
      if (disposed || request !== queryVersion) return;
      ownWindowId = undefined;
      focused = true; // Extension API unavailable: visibility-only, never permanent inactivity.
      notify();
    };
    try {
      void windows
        .getCurrent()
        .then((current) => {
          if (disposed || request !== queryVersion) return;
          if (current.id === undefined) {
            degrade();
            return;
          }
          ownWindowId = current.id;
          focused =
            fromFocusEvent || versionAtRequest !== focusVersion
              ? lastFocusedId === ownWindowId
              : (current.focused ?? false);
          notify();
        })
        .catch(degrade);
    } catch {
      degrade();
    }
  }
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  if (windowApi) {
    windows.onFocusChanged.addListener(onWindowFocus);
    // Capture the current window ID, not document.hasFocus(): omnibox focus must not pause it.
    requestCurrent();
  } else if (!env.extension) {
    // Standalone web/tests have no reliable browser-window API.
    window.addEventListener("focus", onFallbackFocus);
    window.addEventListener("blur", onFallbackBlur);
  }
  return {
    isActive: () => active,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      if (windowApi) windows.onFocusChanged.removeListener(onWindowFocus);
      else if (!env.extension) {
        window.removeEventListener("focus", onFallbackFocus);
        window.removeEventListener("blur", onFallbackBlur);
      }
    },
  };
}
