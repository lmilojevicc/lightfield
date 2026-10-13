import {
  validateCustomThemes,
  CUSTOM_THEMES_KEY,
} from "../src/domain/themes/custom-themes";
import { SETTINGS_WRITE_LOCK_NAME } from "../src/domain/settings/schema";

export const devThemeFixtures = validateCustomThemes([
  {
    id: "custom:dev-ocean",
    name: "Dev Ocean",
    paper: "#102438",
    ink: "#edf6ff",
    accent: "#56d4ed",
  },
  {
    id: "custom:dev-sand",
    name: "Dev Sand",
    paper: "#fff4dc",
    ink: "#382a18",
    accent: "#a33e16",
  },
  {
    id: "custom:dev-forest",
    name: "Dev Forest with a longer preview name",
    paper: "#142b21",
    ink: "#e9f5dd",
    accent: "#b7df66",
  },
]);

// Run only in the owned extension page. The app uses this same origin-scoped
// settings lock; presence (even an empty collection) must win over fixtures.
export const seedDevThemesExpression = `(() => {
  globalThis.__lightfieldDevThemeSeed = { status: 'pending' };
  (async () => {
    const storage = (globalThis.browser ?? globalThis.chrome).storage.local;
    if (!navigator.locks) throw new Error('Extension settings lock unavailable');
    await navigator.locks.request(${JSON.stringify(SETTINGS_WRITE_LOCK_NAME)}, { mode: 'exclusive' }, async () => {
      const key = ${JSON.stringify(CUSTOM_THEMES_KEY)};
      const current = await storage.get(key);
      if (!Object.prototype.hasOwnProperty.call(current, key))
        await storage.set({ [key]: ${JSON.stringify(devThemeFixtures)} });
    });
    globalThis.__lightfieldDevThemeSeed = { status: 'done' };
  })().catch(error => {
    globalThis.__lightfieldDevThemeSeed = { status: 'error', message: String(error) };
  });
  return true;
})()`;

// Firefox's inspected-window eval returns a grip, not an awaited Promise.
// Poll a serializable completion marker so both native protocols acknowledge
// the storage write (and surface rejection) before launcher readiness.
export async function seedDevThemes(
  evaluate: (expression: string) => Promise<unknown>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const deadline = Date.now() + 10000;
  await evaluate(seedDevThemesExpression);
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const raw = await evaluate(
      "JSON.stringify(globalThis.__lightfieldDevThemeSeed)",
    );
    const result =
      typeof raw === "string"
        ? (JSON.parse(raw) as { status: string; message?: string })
        : undefined;
    if (result?.status === "done") return;
    if (result?.status === "error")
      throw new Error(
        `Development theme fixtures failed: ${result.message ?? "Unknown storage error"}`,
      );
    await Bun.sleep(100);
  }
  throw new Error(
    "Development theme fixtures timed out awaiting extension storage; restart the owned launcher.",
  );
}
