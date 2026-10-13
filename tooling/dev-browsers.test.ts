import { expect, spyOn, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  utimes,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { watch } from "node:fs";
import { launchBrowsers } from "./dev-browsers";
import { root } from "./paths";
import { CUSTOM_THEMES_KEY } from "../src/domain/themes/custom-themes";
import { DEFAULT_SETTINGS } from "../src/domain/settings/schema";
import { devThemeFixtures } from "./dev-theme-fixtures";
import { developmentGeckoId } from "./manifest";

// Opt-in real browsers only, always literal headless flags; no normal profiles.
test.skipIf(process.env.LIGHTFIELD_DEV_SMOKE !== "1")(
  "owned headless browsers rebuild/reload the actual extension and clean up",
  async () => {
    const source = resolve(root, "src/styles/index.css");
    const original = await readFile(source, "utf8");
    const unrelated = Bun.spawn(
      [process.execPath, "-e", "await Bun.sleep(240000)"],
      { stdout: "ignore", stderr: "ignore" },
    );
    let reloads = 0;
    const log = console.log.bind(console);
    const logging = spyOn(console, "log").mockImplementation(
      (...args: unknown[]) => {
        if (String(args[0]).startsWith("lightfield: rebuilt both targets"))
          reloads++;
        log(...args);
      },
    );
    const session = await launchBrowsers(true);
    if (!session.chromium) throw new Error("Startup stopped unexpectedly");
    const { chromium, remote, firefox, firefoxUrl, chromiumUrl } = session;
    const chromiumPid = chromium.chromiumInstance.process.pid;
    const firefoxPid = firefox.pid;
    const initialHtml = await readFile(
      resolve(session.owned, "extension/chromium/newtab.html"),
      "utf8",
    );
    async function chromiumEval(expression: string) {
      const targets = await chromium.cdp.sendCommand("Target.getTargets", {});
      const page = targets.targetInfos?.find(
        (page) => page.url === chromiumUrl,
      );
      if (!page) throw new Error("lightfield Chromium page missing");
      const attached = await chromium.cdp.sendCommand("Target.attachToTarget", {
        targetId: page.targetId,
        flatten: true,
      });
      try {
        const result = await chromium.cdp.sendCommand(
          "Runtime.evaluate",
          { expression, returnByValue: true, awaitPromise: true },
          attached.sessionId,
        );
        return result.result?.value;
      } finally {
        await chromium.cdp.sendCommand("Target.detachFromTarget", {
          sessionId: attached.sessionId,
        });
      }
    }
    async function firefoxEval(expression: string) {
      const tabs = (await remote.client.request("listTabs")) as {
        tabs: { actor: string; url: string }[];
      };
      const page = tabs.tabs.find((page) => page.url === firefoxUrl);
      if (!page)
        throw new Error(
          `lightfield Firefox page missing: ${JSON.stringify(tabs)}`,
        );
      const target = (await remote.client.request({
        to: page.actor,
        type: "getTarget",
      })) as { frame: { webExtensionInspectedWindowActor: string } };
      const response = (await remote.client.request({
        to: target.frame.webExtensionInspectedWindowActor,
        type: "eval",
        webExtensionCallerInfo: {
          addonId: developmentGeckoId,
          url: firefoxUrl,
          lineNumber: 1,
        },
        expression,
        options: {},
      })) as { evalResult: { value?: unknown; exceptionInfo?: unknown } };
      if (response.evalResult.exceptionInfo)
        throw new Error(JSON.stringify(response.evalResult.exceptionInfo));
      return response.evalResult.value;
    }
    async function firefoxAsync(expression: string) {
      await firefoxEval(
        `globalThis.__fixtureSmoke = undefined; (${expression}).then(value => globalThis.__fixtureSmoke = JSON.stringify(value)); true`,
      );
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await firefoxEval("globalThis.__fixtureSmoke");
        if (typeof value === "string")
          return JSON.parse(value) as Record<string, unknown>;
        await Bun.sleep(100);
      }
      throw new Error("Firefox asynchronous storage read timed out");
    }
    async function stored() {
      const expression = `storage.local.get(null)`;
      return [
        await chromiumEval(`chrome.${expression}`),
        await firefoxAsync(`browser.${expression}`),
      ] as Record<string, unknown>[];
    }
    async function waitFor(check: () => Promise<boolean>) {
      for (let attempt = 0; attempt < 150; attempt++) {
        try {
          if (await check()) return;
        } catch (error) {
          if (attempt === 149) throw error;
        }
        await Bun.sleep(200);
      }
      throw new Error("Timed out waiting for browser rebuild/reload");
    }
    try {
      await waitFor(
        async () =>
          (await chromiumEval("document.title")) === "lightfield" &&
          (await firefoxEval("document.title")) === "lightfield",
      );
      expect(String(await chromiumEval("document.body.innerText"))).toContain(
        "Effect settings",
      );
      expect(String(await firefoxEval("document.body.innerText"))).toContain(
        "Effect settings",
      );
      for (const values of await stored()) {
        expect(values[CUSTOM_THEMES_KEY]).toEqual(devThemeFixtures);
        // No persisted selection is required: the app's domain default remains active.
        expect(
          await chromiumEval("document.documentElement.dataset.theme"),
        ).toBe(DEFAULT_SETTINGS.theme);
        expect(
          await firefoxEval("document.documentElement.dataset.theme"),
        ).toBe(DEFAULT_SETTINGS.theme);
        expect(
          (values["lightfield:settings"] as { theme?: string } | undefined)
            ?.theme ?? DEFAULT_SETTINGS.theme,
        ).toBe(DEFAULT_SETTINGS.theme);
      }
      const edited = [{ ...devThemeFixtures[0], name: "Dev Ocean edited" }];
      await chromiumEval(
        `chrome.storage.local.set(${JSON.stringify({ [CUSTOM_THEMES_KEY]: edited })})`,
      );
      await firefoxAsync(
        `browser.storage.local.set(${JSON.stringify({ [CUSTOM_THEMES_KEY]: [] })}).then(() => true)`,
      );
      await chromiumEval(
        "chrome.storage.local.set({lightfieldDevSmoke: 'preserved'})",
      );
      await firefoxEval(
        "browser.storage.local.set({lightfieldDevSmoke: 'preserved'}); true",
      );
      async function idle(label: string) {
        const start = new Date().toISOString();
        const before = reloads;
        await Bun.sleep(32000);
        expect(reloads).toBe(before);
        console.log(
          `IDLE ${label}: ${start} to ${new Date().toISOString()}; extra rebuild/reloads=${String(reloads - before)}`,
        );
      }
      await idle("ready");
      const generated: {
        parent: string;
        directory: string;
        parentExisted: boolean;
      }[] = [];
      try {
        for (const parent of [resolve(root, "dist")]) {
          const parentExisted = await access(parent).then(
            () => true,
            () => false,
          );
          await mkdir(parent, { recursive: true });
          const directory = await mkdtemp(
            resolve(parent, "lightfield-dev-smoke-"),
          );
          generated.push({ parent, directory, parentExisted });
          await writeFile(resolve(directory, "generated.css"), "/* noise */");
          console.log(
            `EXCLUDED ROOT NOISE: ${new Date().toISOString()}; path=${directory}`,
          );
        }
        await utimes(source, new Date(), new Date());
        await writeFile(source, original);
        await idle("generated/metadata/identical-content noise");
      } finally {
        for (const { parent, directory, parentExisted } of generated) {
          await rm(directory, { recursive: true, force: true });
          if (!parentExisted) await rmdir(parent);
        }
      }
      expect(reloads).toBe(0);
      await writeFile(
        source,
        original + "\n:root { --lightfield-dev-smoke: reloaded; }\n",
      );
      await waitFor(
        async () =>
          (await chromiumEval(
            "getComputedStyle(document.documentElement).getPropertyValue('--lightfield-dev-smoke').trim()",
          )) === "reloaded" &&
          (await firefoxEval(
            "getComputedStyle(document.documentElement).getPropertyValue('--lightfield-dev-smoke').trim()",
          )) === "reloaded",
      );
      await waitFor(() => Promise.resolve(reloads === 1));
      await idle("one real edit");
      expect(reloads).toBe(1);
      expect(chromium.chromiumInstance.process.pid).toBe(chromiumPid);
      expect(firefox.pid).toBe(firefoxPid);
      expect(
        await chromiumEval(
          "chrome.storage.local.get('lightfieldDevSmoke').then(v => v.lightfieldDevSmoke)",
        ),
      ).toBe("preserved");
      await firefoxEval(
        "browser.storage.local.get('lightfieldDevSmoke').then(v => globalThis.lightfieldDevSmokeResult = v.lightfieldDevSmoke); true",
      );
      await Bun.sleep(300);
      expect(await firefoxEval("globalThis.lightfieldDevSmokeResult")).toBe(
        "preserved",
      );
      const preserved = await stored();
      expect(preserved[0]?.[CUSTOM_THEMES_KEY]).toEqual(edited);
      expect(preserved[1]?.[CUSTOM_THEMES_KEY]).toEqual([]);
      const beforeActiveEdit = reloads;
      let activeEdit: Promise<void> | undefined;
      const building = watch(
        session.owned,
        { recursive: true },
        (_event, filename) => {
          if (String(filename) !== "stage/chromium/newtab.html" || activeEdit)
            return;
          console.log(
            `ACTIVE BUILD EDIT: ${new Date().toISOString()}; trigger=${String(filename)}`,
          );
          activeEdit = writeFile(
            source,
            original + "\n:root { --lightfield-dev-smoke: latest; }\n",
          );
        },
      );
      try {
        await writeFile(
          source,
          original + "\n:root { --lightfield-dev-smoke: intermediate; }\n",
        );
        await waitFor(
          async () =>
            (await chromiumEval(
              "getComputedStyle(document.documentElement).getPropertyValue('--lightfield-dev-smoke').trim()",
            )) === "latest" &&
            (await firefoxEval(
              "getComputedStyle(document.documentElement).getPropertyValue('--lightfield-dev-smoke').trim()",
            )) === "latest",
        );
        await activeEdit;
      } finally {
        building.close();
      }
      await waitFor(() => Promise.resolve(reloads === beforeActiveEdit + 2));
      await idle("edit during active build");
      expect(reloads).toBe(beforeActiveEdit + 2);
      const workingHtml = await readFile(
        resolve(session.owned, "extension/chromium/newtab.html"),
        "utf8",
      );
      expect(workingHtml).not.toBe(initialHtml);
      await writeFile(
        source,
        '@import "./lightfield-missing-smoke-file.css";\n' + original,
      );
      await Bun.sleep(3000);
      expect(
        await readFile(
          resolve(session.owned, "extension/chromium/newtab.html"),
          "utf8",
        ),
      ).toBe(workingHtml);
      expect(
        await chromiumEval(
          "getComputedStyle(document.documentElement).getPropertyValue('--lightfield-dev-smoke').trim()",
        ),
      ).toBe("latest");
      await writeFile(source, original);
      await waitFor(
        async () =>
          (await chromiumEval(
            "getComputedStyle(document.documentElement).getPropertyValue('--lightfield-dev-smoke').trim()",
          )) === "" &&
          (await firefoxEval(
            "getComputedStyle(document.documentElement).getPropertyValue('--lightfield-dev-smoke').trim()",
          )) === "",
      );
      console.log(
        `HEADLESS SMOKE: Chromium PID ${String(chromiumPid)}, Firefox PID ${String(firefoxPid)}; actual lightfield DOM in both; source rebuild/reload, storage preserved, compile failure kept working build, recovery passed.`,
      );
    } finally {
      await writeFile(source, original);
      await session.stop();
      logging.mockRestore();
      expect(unrelated.exitCode).toBeNull();
      unrelated.kill();
      await unrelated.exited;
    }
    expect(access(session.owned)).rejects.toThrow();
    expect(() => process.kill(firefoxPid, 0)).toThrow();
    expect(() => process.kill(chromiumPid, 0)).toThrow();
  },
  240000,
);

test.skipIf(process.env.LIGHTFIELD_DEV_SMOKE !== "1")(
  "SIGINT and SIGTERM clean up only owned headless children",
  async () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          `import { launchBrowsers } from './tooling/dev-browsers.ts'; const s = await launchBrowsers(true); console.log('SIGNAL_READY:' + JSON.stringify({owned: s.owned, chromium: s.chromium.chromiumInstance.process.pid, firefox: s.firefox.pid}));`,
        ],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
      );
      let output = "";
      const collecting = (async () => {
        for await (const chunk of child.stdout)
          output += new TextDecoder().decode(chunk);
      })();
      const stderr = new Response(child.stderr).text();
      try {
        for (
          let attempt = 0;
          attempt < 200 && !output.includes("SIGNAL_READY:");
          attempt++
        )
          await Bun.sleep(100);
        const line = output
          .split("\n")
          .find((line) => line.startsWith("SIGNAL_READY:"));
        if (!line)
          throw new Error(`Startup failed: ${output}\n${await stderr}`);
        const ready = JSON.parse(line.slice("SIGNAL_READY:".length)) as {
          owned: string;
          chromium: number;
          firefox: number;
        };
        child.kill(signal);
        await child.exited;
        expect(access(ready.owned)).rejects.toThrow();
        expect(() => process.kill(ready.chromium, 0)).toThrow();
        expect(() => process.kill(ready.firefox, 0)).toThrow();
        console.log(
          `${signal}: owned profiles removed; owned browser PIDs gone.`,
        );
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGTERM");
        await child.exited;
        await collecting;
        await stderr;
      }
    }
  },
  90000,
);

test.skipIf(process.env.LIGHTFIELD_DEV_SMOKE !== "1")(
  "owned headless --no-fixtures startup leaves both collections absent",
  async () => {
    const session = await launchBrowsers(true, { fixtures: false });
    if (!session.chromium) throw new Error("Startup stopped unexpectedly");
    const { chromium, remote, chromiumUrl, firefoxUrl } = session;
    try {
      const targets = await chromium.cdp.sendCommand("Target.getTargets", {});
      const page = targets.targetInfos?.find(
        (page) => page.url === chromiumUrl,
      );
      if (!page) throw new Error("Owned Chromium page missing");
      const attached = await chromium.cdp.sendCommand("Target.attachToTarget", {
        targetId: page.targetId,
        flatten: true,
      });
      try {
        const value = await chromium.cdp.sendCommand(
          "Runtime.evaluate",
          {
            expression: `chrome.storage.local.get(${JSON.stringify(CUSTOM_THEMES_KEY)}).then(v => Object.hasOwn(v, ${JSON.stringify(CUSTOM_THEMES_KEY)}))`,
            awaitPromise: true,
            returnByValue: true,
          },
          attached.sessionId,
        );
        expect(value.result?.value).toBe(false);
      } finally {
        await chromium.cdp.sendCommand("Target.detachFromTarget", {
          sessionId: attached.sessionId,
        });
      }
      const tabs = (await remote.client.request("listTabs")) as {
        tabs: { actor: string; url: string }[];
      };
      const tab = tabs.tabs.find((tab) => tab.url === firefoxUrl);
      if (!tab) throw new Error("Owned Firefox page missing");
      const target = (await remote.client.request({
        to: tab.actor,
        type: "getTarget",
      })) as { frame: { webExtensionInspectedWindowActor: string } };
      const evaluate = async (expression: string) => {
        const response = (await remote.client.request({
          to: target.frame.webExtensionInspectedWindowActor,
          type: "eval",
          expression,
          options: {},
          webExtensionCallerInfo: {
            addonId: developmentGeckoId,
            url: firefoxUrl,
            lineNumber: 1,
          },
        })) as { evalResult: { value?: unknown; exceptionInfo?: unknown } };
        if (response.evalResult.exceptionInfo)
          throw new Error(JSON.stringify(response.evalResult.exceptionInfo));
        return response.evalResult.value;
      };
      await evaluate(
        `browser.storage.local.get(${JSON.stringify(CUSTOM_THEMES_KEY)}).then(v => globalThis.__fixtureAbsent = !Object.hasOwn(v, ${JSON.stringify(CUSTOM_THEMES_KEY)})); true`,
      );
      let result: unknown;
      for (let attempt = 0; attempt < 100; attempt++) {
        result = await evaluate("globalThis.__fixtureAbsent");
        if (result !== undefined) break;
        await Bun.sleep(100);
      }
      expect(result).toBe(true);
    } finally {
      await session.stop();
    }
  },
  60000,
);
