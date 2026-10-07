<script lang="ts">
  import { onMount, flushSync, untrack } from "svelte";
  import type { AppServices, SettingsSnapshot } from "../../services/contracts";
  import { SEARCH_URLS, type SearchEngine } from "../../domain/settings/schema";
  import { createActiveClock } from "../../services/active-ui-work";
  import { formatRailDate, formatRailAccessibleName } from "./clock-format";
  import {
    createIslandLifecycle,
    createSearchMorph,
    islandProximityZone,
    withinIslandProximity,
    ISLAND_PROXIMITY_SLACK,
    type IslandProjection,
  } from "./island-lifecycle";
  import { SEARCH_ENGINES } from "./search-engines";
  import { shortcutAction } from "./shortcuts";
  import EngineIcon from "./EngineIcon.svelte";
  import WeatherIcon from "./WeatherIcon.svelte";
  const {
    services,
    snapshot,
    overlayOpen = false,
    busy = false,
    tuneAvailable = false,
    onOpenSettings,
    onOpenTuner,
    onNavigate = (url: string) => {
      window.location.assign(url);
    },
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    overlayOpen?: boolean;
    busy?: boolean;
    tuneAvailable?: boolean;
    onOpenSettings: () => void;
    onOpenTuner: () => void;
    onNavigate?: (url: string) => void;
  } = $props();
  let now = $state(new Date());
  let weather = $state(untrack(() => services.weather.current()));
  let searching = $state(false),
    popover = $state(false),
    query = $state("");
  let projection = $state<IslandProjection>({
    tucked: false,
    idle: false,
    handle: false,
  });
  let width = $state<number | null>(null),
    measuring = $state(false);
  let island: HTMLDivElement,
    container: HTMLElement,
    content: HTMLDivElement,
    reveal: HTMLButtonElement,
    form: HTMLFormElement,
    input: HTMLInputElement,
    clockElement: HTMLElement,
    clockButton: HTMLButtonElement;
  let lifecycle: ReturnType<typeof createIslandLifecycle> | undefined;
  let morph: ReturnType<typeof createSearchMorph> | undefined;
  let previous: HTMLElement | null = null;
  let alive = false;
  const hour = $derived(
    snapshot.settings.twentyFourHour
      ? String(now.getHours()).padStart(2, "0")
      : String(now.getHours() % 12 || 12),
  );
  const minute = $derived(String(now.getMinutes()).padStart(2, "0"));
  const miniTime = $derived(`${hour.padStart(2, "0")}:${minute}`);
  const clockText = $derived(
    `${hour.padStart(2, " ")}:${minute}${snapshot.settings.seconds ? `:${String(now.getSeconds()).padStart(2, "0")}` : ""}`,
  );
  const dateParts = $derived(
    snapshot.settings.showDate
      ? {
          weekday: snapshot.settings.showWeekday,
          month: snapshot.settings.showMonth,
          day: snapshot.settings.showDay,
          year: snapshot.settings.showYear,
        }
      : null,
  );
  const dateText = $derived(dateParts ? formatRailDate(now, dateParts) : "");
  const accessibleName = $derived(
    formatRailAccessibleName(
      now,
      {
        seconds: snapshot.settings.seconds,
        twentyFourHour: snapshot.settings.twentyFourHour,
      },
      dateParts,
    ),
  );
  $effect(() => {
    lifecycle?.setMode(snapshot.settings.islandMode);
  });
  $effect(() => {
    if (overlayOpen || busy || snapshot.persistence.status === "saving")
      lifecycle?.refresh();
    else lifecycle?.settle();
  });
  $effect(() => {
    if (!snapshot.settings.showSearch && searching)
      queueMicrotask(() => {
        if (alive && !snapshot.settings.showSearch) collapse();
      });
  });
  /** Settings/tuner integration restores the source scene target, including Hidden mode's pill. */
  export function restoreSettingsFocus() {
    if (snapshot.settings.islandMode === "hidden" && !searching) {
      reveal.hidden = false;
      lifecycle?.restoreHandleFocus(() => {
        reveal.focus({ preventScroll: true });
      });
    } else {
      lifecycle?.reveal();
      island
        .querySelector<HTMLButtonElement>(
          searching ? "#search-settings-btn" : "#settings-open",
        )
        ?.focus({ preventScroll: true });
    }
  }
  function expand() {
    if (!snapshot.settings.showSearch || overlayOpen) return;
    if (!searching)
      previous =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    lifecycle?.reveal();
    morph?.set(true);
    flushSync();
    input.focus();
    input.select();
    lifecycle?.activity();
  }
  function collapse(restore = true) {
    if (!searching) return;
    popover = false;
    morph?.set(false);
    flushSync();
    if (restore) {
      if (snapshot.settings.islandMode === "hidden")
        lifecycle?.restoreHandleFocus(() => {
          reveal.focus();
        });
      else if (
        previous?.isConnected &&
        previous !== document.body &&
        !previous.closest("[inert], [hidden]")
      )
        previous.focus();
      else clockButton.focus();
    }
    lifecycle?.activity();
  }
  function chooseEngine(engine: SearchEngine) {
    popover = false;
    input.focus();
    void services.settings.patch({ searchEngine: engine }).catch(() => {});
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value) {
      collapse();
      onNavigate(SEARCH_URLS[snapshot.settings.searchEngine](value));
    }
  }
  onMount(() => {
    alive = true;
    const stops: (() => void)[] = [];
    const listen = <K extends keyof WindowEventMap>(
      type: K,
      fn: (event: WindowEventMap[K]) => void,
    ) => {
      window.addEventListener(type, fn);
      stops.push(() => {
        window.removeEventListener(type, fn);
      });
    };
    const clock = createActiveClock(services.activity, () => {
      now = new Date();
    });
    const font = services.observeClockFont(clockElement);
    stops.push(
      () => {
        clock.dispose();
      },
      () => {
        font.dispose();
      },
      services.weather.subscribe((view) => {
        weather = view;
      }),
    );
    let pointerNear = false,
      keyboard = true,
      handleKeyboard = false;
    lifecycle = createIslandLifecycle({
      scene: () => ({
        searching: searching || popover,
        overlay: overlayOpen,
        hovered: island.matches(":hover") || reveal.matches(":hover"),
        focused: island.contains(document.activeElement),
        handleFocused: document.activeElement === reveal && handleKeyboard,
        pointerNear,
        busy: busy || snapshot.persistence.status === "saving",
        active: services.activity.isActive(),
      }),
      project: (state) => {
        projection = state;
      },
      schedule: (done, ms) => window.setTimeout(done, ms),
      cancel: (handle) => {
        window.clearTimeout(handle as number);
      },
    });
    morph = createSearchMorph({
      width: () => island.getBoundingClientRect().width,
      measuring: (value) => {
        measuring = value;
      },
      project: (value) => {
        searching = value;
        document.documentElement.dataset.searchVisible = String(value);
        flushSync();
      },
      naturalWidth: () => island.getBoundingClientRect().width,
      setWidth: (value) => {
        width = value;
      },
      flush: () => {
        flushSync();
        island.getBoundingClientRect();
      },
      reducedMotion: () => services.reducedMotion(),
      schedule: (done, ms) => window.setTimeout(done, ms),
      cancel: (handle) => {
        window.clearTimeout(handle as number);
      },
    });
    lifecycle.setMode(snapshot.settings.islandMode);
    stops.push(
      services.subscribeReducedMotion((value) => {
        if (value) morph?.finish();
      }),
      services.activity.subscribe((active) => {
        if (active) lifecycle?.activity();
        else lifecycle?.dispose();
      }),
    );
    listen("keydown", (event) => {
      keyboard = true;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = shortcutAction(event, {
        overlay: overlayOpen,
        searching,
        editing:
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          !!target?.isContentEditable,
      });
      if (action) {
        event.preventDefault();
        if (action === "search") expand();
        else if (action === "settings") onOpenSettings();
        else lifecycle?.toggle();
      }
      if (event.key === "Escape" && !event.defaultPrevented && !overlayOpen) {
        if (popover) {
          event.preventDefault();
          popover = false;
          input.focus();
        } else if (searching && !query.trim()) {
          event.preventDefault();
          collapse();
        } else if (searching && document.activeElement === input) {
          event.preventDefault();
          query = "";
        }
      }
      lifecycle?.activity();
    });
    let frame: number | undefined, point: { x: number; y: number } | undefined;
    const clearNear = () => {
      point = undefined;
      if (pointerNear) {
        pointerNear = false;
        lifecycle?.settle();
      }
    };
    const track = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      point = { x: event.clientX, y: event.clientY };
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (!point) return;
        const capsule = island.getBoundingClientRect(),
          slot = container.getBoundingClientRect();
        const zone = islandProximityZone(
          {
            width: Math.max(capsule.width, content.offsetWidth),
            height: Math.max(capsule.height, content.offsetHeight),
          },
          (slot.left + slot.right) / 2,
          slot.bottom,
          pointerNear ? ISLAND_PROXIMITY_SLACK : 0,
        );
        const near =
          snapshot.settings.islandMode === "hidden" &&
          (island.matches(":hover") ||
            reveal.matches(":hover") ||
            withinIslandProximity(zone, point.x, point.y));
        if (near !== pointerNear) {
          pointerNear = near;
          if (near) lifecycle?.reveal();
          else lifecycle?.settle();
        }
      });
    };
    listen("pointermove", track);
    listen("pointerdown", (event) => {
      keyboard = false;
      track(event);
    });
    listen("pointerleave", clearNear);
    document.addEventListener("pointerleave", clearNear);
    stops.push(() => {
      document.removeEventListener("pointerleave", clearNear);
    });
    for (const type of ["mousemove", "mousedown", "touchstart"] as const)
      listen(type, () => lifecycle?.activity());
    listen("click", (event) => {
      if (
        event.target instanceof Node &&
        !island.querySelector(".search__engine-wrap")?.contains(event.target)
      )
        popover = false;
    });
    const focus = () => {
      handleKeyboard = keyboard;
      lifecycle?.focus();
    };
    const blur = () => {
      queueMicrotask(() => {
        if (!alive) return;
        if (!form.contains(document.activeElement) && !overlayOpen)
          collapse(false);
        lifecycle?.activity();
      });
    };
    const enter = () => lifecycle?.reveal();
    const leave = () => lifecycle?.activity();
    for (const element of [island, reveal]) {
      element.addEventListener("focusin", focus);
      element.addEventListener("focusout", blur);
      element.addEventListener("pointerenter", enter);
      element.addEventListener("pointerleave", leave);
      stops.push(() => {
        element.removeEventListener("focusin", focus);
        element.removeEventListener("focusout", blur);
        element.removeEventListener("pointerenter", enter);
        element.removeEventListener("pointerleave", leave);
      });
    }
    return () => {
      alive = false;
      stops.forEach((stop) => {
        stop();
      });
      if (frame !== undefined) cancelAnimationFrame(frame);
      morph?.finish();
      lifecycle?.dispose();
      delete document.documentElement.dataset.searchVisible;
    };
  });
</script>

<main class="page" inert={overlayOpen}>
  <button
    class="island-reveal"
    id="island-reveal"
    type="button"
    aria-label="Reveal Island"
    aria-controls="island"
    aria-expanded={!projection.tucked}
    hidden={!projection.handle}
    bind:this={reveal}
    onclick={() => lifecycle?.focus()}
  ></button>
  <header class="island-container" id="island-container" bind:this={container}>
    <div
      class="island"
      id="island"
      bind:this={island}
      class:is-searching={searching}
      class:is-hidden={projection.tucked}
      class:is-idle={projection.idle}
      inert={projection.tucked}
      aria-hidden={projection.tucked}
      style:width={width === null ? undefined : `${String(width)}px`}
      style:transition={measuring ? "none" : undefined}
      role="toolbar"
      aria-label="lightfield Island"
    >
      <div class="island__handle" aria-hidden="true"></div>
      <!-- Collapsed / Default State -->
      <div
        class="island__content"
        id="island-content"
        bind:this={content}
        inert={searching}
        aria-hidden={searching}
      >
        <button
          class="island__time-btn"
          id="island-time-btn"
          bind:this={clockButton}
          onclick={expand}
          type="button"
          aria-label={`Clock: ${accessibleName}. Click or press / to search`}
          title="Search (/ or ⌘K)"
        >
          <time
            class="island__time clock-digits"
            id="island-time"
            bind:this={clockElement}
            datetime={now.toISOString()}
            aria-label={accessibleName}
            >{#each Array.from(clockText) as character, index (index)}<span
                class={character === ":" ? "clock-separator" : "clock-digit"}
                aria-hidden="true">{character}</span
              >{/each}</time
          >
          <span
            class="island__ampm"
            id="island-ampm"
            aria-hidden="true"
            hidden={snapshot.settings.twentyFourHour}
            >{now.getHours() < 12 ? "AM" : "PM"}</span
          >
          <span class="island__date" id="island-date" hidden={!dateText}
            >{dateText}</span
          >
        </button>
        <div
          class="island__divider"
          id="divider-search"
          hidden={!snapshot.settings.showSearch}
          aria-hidden="true"
        ></div>
        <button
          class="island__search-hint"
          id="island-search-hint"
          hidden={!snapshot.settings.showSearch}
          onclick={expand}
          type="button"
          aria-label="Search the web. Click or press /"
          title="Search (/ or ⌘K)"
        >
          <svg
            class="search-hint__icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            ><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg
          >
          <span class="search-hint__text">Search</span>
          <kbd class="search-hint__kbd">/</kbd>
        </button>
        <div
          class="island__divider"
          id="divider-weather"
          hidden={weather.hidden}
          aria-hidden="true"
        ></div>
        <div
          class="island__weather island__weather-chip"
          id="island-weather"
          class:has-location={Boolean(weather.location)}
          hidden={weather.hidden}
          aria-label={weather.accessibleName}
          role="status"
          aria-live="polite"
          title={weather.title}
        >
          <span class="weather__icon-wrap" id="island-weather-icon-wrap"
            ><span
              class="weather__icon"
              id="island-weather-icon"
              aria-hidden="true"
              title={weather.description}
              ><WeatherIcon code={weather.code} /></span
            ></span
          >
          <span class="weather__temp" id="island-weather-temp"
            >{weather.temperature}</span
          >
          <span
            class="weather__location"
            id="island-weather-location"
            hidden={!weather.location}
            title={weather.location}>{weather.location}</span
          >
        </div>
        <div
          class="island__divider island__divider--action"
          aria-hidden="true"
        ></div>
        <button
          class="island__btn island__btn--gear"
          id="settings-open"
          onclick={onOpenSettings}
          type="button"
          aria-label="Settings"
          title="Settings (,)"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            ><path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            /><circle cx="12" cy="12" r="3" /></svg
          >
        </button>
      </div>

      <!-- In-Place Expanded Search State -->
      <form
        class="island__search-expanded"
        id="search-form"
        bind:this={form}
        role="search"
        inert={!searching}
        aria-hidden={!searching}
        onsubmit={submit}
      >
        <button
          class="search__time-chip"
          id="search-collapse-btn"
          onclick={() => {
            collapse();
          }}
          type="button"
          aria-label="Collapse search"
          title="Back (Esc)"
        >
          <span class="search__time-mini" id="search-time-mini">{miniTime}</span
          >
        </button>
        <div class="search__divider" aria-hidden="true"></div>
        <div class="search__form">
          <!-- Search Engine Popover Trigger -->
          <div class="search__engine-wrap">
            <button
              class="search__engine-btn"
              id="search-engine-btn"
              onclick={() => {
                popover = !popover;
              }}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={popover}
              aria-label="Select search engine"
            >
              <span class="engine-btn__icon" id="search-engine-icon">
                <EngineIcon engine={snapshot.settings.searchEngine} />
              </span>
              <span class="search__engine-tag" id="search-engine-tag"
                >{SEARCH_ENGINES.find(
                  (engine) => engine.id === snapshot.settings.searchEngine,
                )?.name}</span
              >
              <svg
                class="engine-btn__chevron"
                viewBox="0 0 24 24"
                width="11"
                height="11"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg
              >
            </button>
            <div
              class="search__engine-popover"
              id="search-engine-popover"
              role="listbox"
              aria-label="Search engines"
              hidden={!popover}
            >
              {#each SEARCH_ENGINES as engine (engine.id)}
                <button
                  class="engine-popover-item"
                  class:is-active={snapshot.settings.searchEngine === engine.id}
                  type="button"
                  role="option"
                  aria-selected={snapshot.settings.searchEngine === engine.id}
                  data-engine-id={engine.id}
                  data-engine={engine.id}
                  onclick={() => {
                    chooseEngine(engine.id);
                  }}
                >
                  <span class="engine-popover-item__icon"
                    ><EngineIcon engine={engine.id} /></span
                  >
                  <div class="engine-popover-item__info">
                    <span class="engine-popover-item__name">{engine.name}</span
                    ><span class="engine-popover-item__badge"
                      >{engine.badge}</span
                    >
                  </div>
                  <svg
                    class="engine-popover-item__check"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"><polyline points="20 6 9 17 4 12" /></svg
                  >
                </button>
              {/each}
            </div>
          </div>
          <!-- Search Input -->
          <label class="visually-hidden" for="search-input"
            >Search the web</label
          >
          <input
            class="search__input"
            id="search-input"
            bind:this={input}
            bind:value={query}
            type="search"
            placeholder="Search the web…"
            autocomplete="off"
            spellcheck="false"
            maxlength="500"
          />
          <button
            class="search__clear-btn"
            id="search-clear-btn"
            type="button"
            aria-label="Clear query"
            hidden={!query}
            onclick={() => {
              query = "";
              input.focus();
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              ><line x1="18" y1="6" x2="6" y2="18" /><line
                x1="6"
                y1="6"
                x2="18"
                y2="18"
              /></svg
            >
          </button>
        </div>
        <div class="search__divider" aria-hidden="true"></div>
        <button
          class="island__btn island__btn--gear"
          id="search-settings-btn"
          onclick={onOpenSettings}
          type="button"
          aria-label="Settings"
          title="Settings (,)"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            ><path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            /><circle cx="12" cy="12" r="3" /></svg
          >
        </button>
      </form>
    </div>
  </header>
</main>

<button
  class="effect-shortcut"
  id="effect-shortcut"
  type="button"
  hidden={!snapshot.settings.showEffectShortcut ||
    !tuneAvailable ||
    overlayOpen}
  onclick={onOpenTuner}
  ><!-- Lucide SlidersHorizontal 1.42.0; see THIRD_PARTY_NOTICES.md. --><svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    ><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path
      d="M16 17v4"
    /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path
      d="M8 10v4"
    /><path d="M8 12H3" /></svg
  >Effect settings</button
>
