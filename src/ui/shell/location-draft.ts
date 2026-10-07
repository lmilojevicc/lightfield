import type { SettingsSession, SettingsDraft } from "../../services/contracts";

/** Claim text immediately; only the newest unsubmitted city draft may debounce. */
export function createLocationDraft(
  settings: Pick<SettingsSession, "stage">,
  timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis,
) {
  let ticket: SettingsDraft | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const clear = () => {
    revision++;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  };
  const flush = async () => {
    clear();
    const pending = ticket;
    ticket = undefined;
    await pending?.commit();
  };
  return {
    edit(location: string) {
      clear();
      ticket?.cancel();
      ticket = settings.stage({ weatherLocation: location });
      const mine = revision;
      timer = timers.setTimeout(() => {
        if (mine !== revision) return;
        void flush().catch(() => {});
      }, 450);
    },
    flush,
    dispose() {
      clear();
      ticket?.cancel();
      ticket = undefined;
    },
  };
}
