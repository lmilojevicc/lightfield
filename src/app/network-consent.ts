import type { Settings } from "../domain/settings/schema";
import type { NetworkConsent } from "../services/create-services";

/** Durable custom-font saves/weather toggles are the existing explicit opt-ins, not new prompts. */
export function createNetworkConsent(options: {
  durable(): Pick<Settings, "fonts">;
  weatherEnabled(): boolean;
  requestFonts(): Promise<boolean>;
  notify(): void;
  alive(): boolean;
  report(error: unknown): void;
}): NetworkConsent & {
  requestFonts(): Promise<boolean>;
} {
  let fonts: boolean | undefined;
  const fontAllowed = () => fonts ?? options.durable().fonts === "custom";
  return {
    fonts: fontAllowed,
    weather: () => options.weatherEnabled(),
    requestFonts() {
      // Deliberately not async: optional permission starts before any gesture loses activation.
      const request = options.requestFonts();
      return request
        .then((granted) => {
          if (!options.alive() || !granted) return false;
          if (!fontAllowed()) {
            fonts = true;
            options.notify();
          }
          return true;
        })
        .catch((error: unknown) => {
          options.report(error);
          return false;
        });
    },
  };
}
