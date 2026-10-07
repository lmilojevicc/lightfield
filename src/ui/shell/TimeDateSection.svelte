<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { AppServices, SettingsSnapshot } from "../../services/contracts";
  import type { SettingsPatch } from "../../domain/settings/schema";
  import { normalizeWeatherLocation } from "../../services/weather";
  import { createWeatherToggle } from "./weather-toggle";
  import { createLocationDraft } from "./location-draft";
  const {
    services,
    snapshot,
    onWeatherConsent,
  }: {
    services: AppServices;
    snapshot: SettingsSnapshot;
    onWeatherConsent?: (enabled: boolean) => void;
  } = $props();
  let location = $state("");
  let focused = $state(false);
  const draft = untrack(() => createLocationDraft(services.settings));
  const toggle = untrack(() =>
    createWeatherToggle({
      settings: services.settings,
      requestLocation: () => services.permissions.request("location"),
      consent: (enabled) => {
        onWeatherConsent?.(enabled);
        services.notifyConsentChanged();
      },
    }),
  );
  $effect(() => {
    if (!focused) location = snapshot.settings.weatherLocation;
  });
  function editLocation(value: string) {
    focused = true;
    location = value;
    if (
      snapshot.settings.showWeather &&
      normalizeWeatherLocation(value) === "auto"
    )
      void services.permissions.request("location").catch(() => {});
    draft.edit(normalizeWeatherLocation(value));
  }
  function flushLocation() {
    focused = false;
    void draft.flush().catch(() => {});
  }
  function save(patch: SettingsPatch) {
    if (patch.showWeather !== undefined) {
      void toggle
        .set(patch.showWeather, normalizeWeatherLocation(location) === "auto")
        .catch(() => {});
    } else void services.settings.patch(patch).catch(() => {});
  }
  onDestroy(() => {
    draft.dispose();
    toggle.dispose();
  });
</script>

<!-- Source category sections retain tabpanel semantics; SettingsShell supplies roving tabs and visibility. -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<section
  class="group modal__panel"
  data-settings-category="time-date"
  id="panel-time-weather"
  role="tabpanel"
  aria-labelledby="tab-btn-time-weather"
>
  <div class="panel__header">
    <h3 class="panel__title">Time, Calendar &amp; Weather</h3>
  </div>

  <fieldset class="settings-owner">
    <legend class="settings-owner__legend">Time</legend>
    <div class="drawer__row modal__option-row">
      <div>
        <div class="drawer__control-label">Time Format</div>
      </div>
      <div class="segmented" role="radiogroup" aria-label="Time format">
        <label class="segmented-item"
          ><input
            type="radio"
            name="twentyFourHour"
            data-setting="twentyFourHour"
            value="true"
            checked={snapshot.settings.twentyFourHour}
            onchange={(e) => {
              save({ twentyFourHour: e.currentTarget.value === "true" });
            }}
          /><span class="segmented-btn">24h</span></label
        >
        <label class="segmented-item"
          ><input
            type="radio"
            name="twentyFourHour"
            data-setting="twentyFourHour"
            value="false"
            checked={!snapshot.settings.twentyFourHour}
            onchange={(e) => {
              save({ twentyFourHour: e.currentTarget.value === "true" });
            }}
          /><span class="segmented-btn">12h</span></label
        >
      </div>
    </div>

    <div class="drawer__row modal__option-row">
      <div>
        <div class="drawer__control-label">Show Seconds</div>
      </div>
      <label class="toggle">
        <input
          type="checkbox"
          data-setting="seconds"
          aria-label="Show seconds"
          checked={snapshot.settings.seconds}
          onchange={(e) => {
            save({ seconds: e.currentTarget.checked });
          }}
        />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
    </div>
  </fieldset>

  <fieldset class="settings-owner">
    <legend class="settings-owner__legend">Date</legend>
    <div class="drawer__row modal__option-row">
      <div>
        <div class="drawer__control-label">Show Date in Capsule</div>
      </div>
      <label class="toggle">
        <input
          type="checkbox"
          data-setting="showDate"
          aria-label="Show date"
          checked={snapshot.settings.showDate}
          onchange={(e) => {
            save({ showDate: e.currentTarget.checked });
          }}
        />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
    </div>
    <div
      class="drawer__row modal__option-row"
      data-date-dependent
      hidden={!snapshot.settings.showDate}
    >
      <div>
        <div class="drawer__control-label">Always Expand Date</div>
      </div>
      <label class="toggle">
        <input
          type="checkbox"
          disabled={!snapshot.settings.showDate}
          data-setting="dateExpanded"
          aria-label="Always expand date"
          checked={snapshot.settings.dateExpanded}
          onchange={(e) => {
            save({ dateExpanded: e.currentTarget.checked });
          }}
        />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
    </div>
    <div class="date-components" role="group" aria-label="Date components">
      <div
        class="control control--sub"
        data-date-dependent
        hidden={!snapshot.settings.showDate}
      >
        <div class="control__row">
          <span class="control__label">Weekday</span>
          <label class="toggle">
            <input
              type="checkbox"
              disabled={!snapshot.settings.showDate}
              data-setting="showWeekday"
              aria-label="Weekday"
              checked={snapshot.settings.showWeekday}
              onchange={(e) => {
                save({ showWeekday: e.currentTarget.checked });
              }}
            />
            <span class="toggle__track"
              ><span class="toggle__thumb"></span></span
            >
          </label>
        </div>
      </div>
      <div
        class="control control--sub"
        data-date-dependent
        hidden={!snapshot.settings.showDate}
      >
        <div class="control__row">
          <span class="control__label">Month</span>
          <label class="toggle">
            <input
              type="checkbox"
              disabled={!snapshot.settings.showDate}
              data-setting="showMonth"
              aria-label="Month"
              checked={snapshot.settings.showMonth}
              onchange={(e) => {
                save({ showMonth: e.currentTarget.checked });
              }}
            />
            <span class="toggle__track"
              ><span class="toggle__thumb"></span></span
            >
          </label>
        </div>
      </div>
      <div
        class="control control--sub"
        data-date-dependent
        hidden={!snapshot.settings.showDate}
      >
        <div class="control__row">
          <span class="control__label">Day</span>
          <label class="toggle">
            <input
              type="checkbox"
              disabled={!snapshot.settings.showDate}
              data-setting="showDay"
              aria-label="Day"
              checked={snapshot.settings.showDay}
              onchange={(e) => {
                save({ showDay: e.currentTarget.checked });
              }}
            />
            <span class="toggle__track"
              ><span class="toggle__thumb"></span></span
            >
          </label>
        </div>
      </div>
      <div
        class="control control--sub"
        data-date-dependent
        hidden={!snapshot.settings.showDate}
      >
        <div class="control__row">
          <span class="control__label">Year</span>
          <label class="toggle">
            <input
              type="checkbox"
              disabled={!snapshot.settings.showDate}
              data-setting="showYear"
              aria-label="Year"
              checked={snapshot.settings.showYear}
              onchange={(e) => {
                save({ showYear: e.currentTarget.checked });
              }}
            />
            <span class="toggle__track"
              ><span class="toggle__thumb"></span></span
            >
          </label>
        </div>
      </div>
    </div>
  </fieldset>

  <fieldset class="settings-owner">
    <legend class="settings-owner__legend">Weather</legend>
    <div class="drawer__row modal__option-row">
      <div>
        <div class="drawer__control-label">Weather Chip</div>
      </div>
      <label class="toggle">
        <input
          type="checkbox"
          data-setting="showWeather"
          aria-label="Show weather"
          aria-describedby="weather-privacy-hint"
          checked={snapshot.settings.showWeather}
          onchange={(e) => {
            save({ showWeather: e.currentTarget.checked });
          }}
        />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
    </div>
    <p class="control__hint" id="weather-privacy-hint">
      Enabling requests Open-Meteo weather data; automatic location asks device
      location and sends only coarse coordinates.
    </p>

    <div class="drawer__row modal__option-row">
      <span class="drawer__control-label">Location in Weather Chip</span>
      <label class="toggle">
        <input
          type="checkbox"
          disabled={!snapshot.settings.showWeather}
          data-setting="showWeatherLocation"
          aria-label="Show location in weather chip"
          aria-describedby="weather-location-display-hint"
          checked={snapshot.settings.showWeatherLocation}
          onchange={(e) => {
            save({ showWeatherLocation: e.currentTarget.checked });
          }}
        />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
    </div>
    <p class="control__hint" id="weather-location-display-hint">
      Automatic location displays “Current location”.
    </p>

    <div class="drawer__row modal__option-row">
      <div>
        <div class="drawer__control-label">Temperature Unit</div>
      </div>
      <div
        class="segmented"
        id="settings-weather-units"
        role="radiogroup"
        aria-label="Temperature unit"
        aria-describedby="weather-options-hint"
      >
        <label class="segmented-item"
          ><input
            type="radio"
            name="weatherUnits"
            disabled={!snapshot.settings.showWeather}
            data-setting="weatherUnits"
            value="c"
            checked={snapshot.settings.weatherUnits === "c"}
            onchange={(e) => {
              save({ weatherUnits: e.currentTarget.value as "c" | "f" });
            }}
          /><span class="segmented-btn">°C</span></label
        >
        <label class="segmented-item"
          ><input
            type="radio"
            name="weatherUnits"
            disabled={!snapshot.settings.showWeather}
            data-setting="weatherUnits"
            value="f"
            checked={snapshot.settings.weatherUnits === "f"}
            onchange={(e) => {
              save({ weatherUnits: e.currentTarget.value as "c" | "f" });
            }}
          /><span class="segmented-btn">°F</span></label
        >
      </div>
    </div>

    <div class="drawer__row modal__option-row weather-location-row">
      <div>
        <label class="drawer__control-label" for="settings-weather-location"
          >Location</label
        >
      </div>
      <input
        class="control__input"
        id="settings-weather-location"
        type="text"
        disabled={!snapshot.settings.showWeather}
        data-setting="weatherLocation"
        aria-describedby="weather-location-hint weather-options-hint"
        placeholder="City or leave blank"
        autocomplete="off"
        maxlength="80"
        value={location}
        onfocus={() => {
          focused = true;
        }}
        oninput={(e) => {
          editLocation(e.currentTarget.value);
        }}
        onblur={flushLocation}
      />
    </div>
    <p class="control__hint" id="weather-location-hint">
      Leave blank or use “auto” for current position.
    </p>
    <p
      class="control__hint"
      id="weather-options-hint"
      hidden={snapshot.settings.showWeather}
    >
      Turn on Weather to change location and temperature unit.
    </p>
  </fieldset>
</section>
