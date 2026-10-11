<script lang="ts">
  import type { AppServices, SettingsSnapshot } from "../../services/contracts";
  import type {
    SearchEngine,
    SettingsPatch,
  } from "../../domain/settings/schema";
  import EngineIcon from "./EngineIcon.svelte";
  import { SEARCH_ENGINES } from "./search-engines";
  const {
    services,
    snapshot,
  }: { services: AppServices; snapshot: SettingsSnapshot } = $props();
  function save(patch: SettingsPatch) {
    void services.settings.patch(patch).catch(() => {});
  }
</script>

<!-- Source category sections retain tabpanel semantics; SettingsShell supplies roving tabs and visibility. -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<section
  class="group modal__panel"
  data-settings-category="search"
  id="panel-search"
  role="tabpanel"
  aria-labelledby="tab-btn-search"
>
  <div class="panel__header">
    <h3 class="panel__title">Default Search Engine</h3>
  </div>

  <div class="control">
    <div class="control__row">
      <span class="control__label">Show search in capsule</span>
      <label class="switch toggle">
        <input
          type="checkbox"
          data-setting="showSearch"
          aria-label="Show search"
          aria-describedby="search-hint"
          checked={snapshot.settings.showSearch}
          onchange={(e) => {
            save({ showSearch: e.currentTarget.checked });
          }}
        />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
    </div>
    <p class="control__hint" id="search-hint">
      Press / from the new tab to focus search.
    </p>
  </div>

  <div class="control">
    <div class="control__row" hidden>
      <span class="control__label">Search engine</span>
      <select
        class="select"
        data-setting="searchEngine"
        aria-label="Search engine"
        aria-describedby="search-engine-hint"
        disabled={!snapshot.settings.showSearch}
        value={snapshot.settings.searchEngine}
        onchange={(e) => {
          save({ searchEngine: e.currentTarget.value as SearchEngine });
        }}
      >
        <option value="google">Google</option>
        <option value="duckduckgo">DuckDuckGo</option>
        <option value="bing">Bing</option>
        <option value="brave">Brave</option>
        <option value="ecosia">Ecosia</option>
        <option value="kagi">Kagi (account required)</option>
        <option value="startpage">Startpage</option>
        <option value="qwant">Qwant</option>
      </select>
    </div>
    <div
      class="engine-picker-grid"
      id="engine-picker-cards"
      role="radiogroup"
      aria-label="Search engines"
    >
      {#each SEARCH_ENGINES as engine (engine.id)}
        <label
          class="engine-card search-engine-card"
          class:is-active={snapshot.settings.searchEngine === engine.id}
          data-engine-id={engine.id}
          data-engine={engine.id}
          aria-checked={snapshot.settings.searchEngine === engine.id}
        >
          <input
            type="radio"
            name="searchEngine"
            value={engine.id}
            data-setting="searchEngine"
            class="visually-hidden"
            checked={snapshot.settings.searchEngine === engine.id}
            disabled={!snapshot.settings.showSearch}
            onchange={() => {
              save({ searchEngine: engine.id });
            }}
          />
          <div class="engine-card__icon" aria-hidden="true">
            <EngineIcon engine={engine.id} size={24} />
          </div>
          <div class="engine-card__info">
            <span class="engine-card__name">{engine.name}</span><span
              class="engine-card__badge">{engine.badge}</span
            >
          </div>
          <span class="engine-card__radio" aria-hidden="true"></span>
        </label>
      {/each}
    </div>
    <p
      class="control__hint"
      id="search-engine-hint"
      hidden={snapshot.settings.showSearch}
    >
      Turn on Search to choose an engine.
    </p>
  </div>
</section>
