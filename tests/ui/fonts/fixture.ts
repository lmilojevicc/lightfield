import { mount } from "svelte";
import FontsFixture from "./FontsFixture.svelte";
import "../../../src/styles/index.css";

export interface FontsFixtureOptions {
  presentation?: "modal" | "drawer";
  custom?: boolean;
  remote?: boolean;
  failSaved?: boolean;
  holdConsent?: boolean;
  holdRetry?: boolean;
  holdSave?: boolean;
  holdPreview?: boolean;
}
export interface FontsFixtureStats {
  previews: number;
  disposed: number;
  retries: number;
  saves: number;
  consent: number;
  display: string;
  body: string;
  blocked: boolean;
}
interface FontsFixtureAPI {
  reset(options: FontsFixtureOptions): Promise<void>;
  close(): void;
  reopen(): void;
  stats(): FontsFixtureStats;
  consent(granted: boolean): void;
  finishRetry(failure?: boolean): void;
  finishSave(): void;
  finishPreview(): void;
  failSaved(): void;
}
declare global {
  interface Window {
    fontsFixture: FontsFixtureAPI;
  }
}
mount(FontsFixture, { target: document.body });
