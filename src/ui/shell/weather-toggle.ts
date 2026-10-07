import type { SettingsSession, SettingsDraft } from "../../services/contracts";

/** A pending permission result cannot publish an obsolete enable after a newer toggle or teardown. */
export function createWeatherToggle(port: {
  settings: Pick<SettingsSession, "stage">;
  requestLocation(): Promise<boolean>;
  consent(enabled: boolean): void;
}) {
  let revision = 0;
  let ticket: SettingsDraft | undefined;
  return {
    async set(enabled: boolean, automatic: boolean): Promise<void> {
      const mine = ++revision;
      ticket?.cancel();
      const draft = port.settings.stage({ showWeather: enabled });
      ticket = draft;
      // requestLocation is invoked synchronously within the original gesture, never a subscription.
      const permission =
        enabled && automatic ? port.requestLocation() : undefined;
      port.consent(enabled);
      try {
        await permission;
        if (mine !== revision) return;
        ticket = undefined;
        await draft.commit();
      } catch (error) {
        if (mine === revision && ticket === draft) {
          ticket = undefined;
          draft.cancel();
        }
        throw error;
      }
    },
    dispose() {
      revision++;
      ticket?.cancel();
      ticket = undefined;
    },
  };
}
