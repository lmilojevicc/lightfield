import { expect, test } from "bun:test";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { launchBrowsers } from "./dev-browsers";
import { root } from "./paths";
import { developmentGeckoId } from "./manifest";

// Opt-in real browsers only, always literal headless flags; no normal profiles.
test.skipIf(process.env.LIGHTFIELD_DEV_SMOKE !== "1")(
  "owned headless browsers rebuild/reload the actual extension and clean up",
  async () => {
    const source = resolve(root, "src/styles/index.css");
    const original = await readFile(source, "utf8");
    const unrelated = Bun.spawn(
      [process.execPath, "-e", "await Bun.sleep(120000)"],
      { stdout: "ignore", stderr: "ignore" },
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
        throw new Error(`lightfield Firefox page missing: ${JSON.stringify(tabs)}`);
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
      await chromiumEval(
        "chrome.storage.local.set({lightfieldDevSmoke: 'preserved'})",
      );
      await firefoxEval(
        "browser.storage.local.set({lightfieldDevSmoke: 'preserved'}); true",
      );
      await Bun.sleep(300);
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
      ).toBe("reloaded");
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
      expect(unrelated.exitCode).toBeNull();
      unrelated.kill();
      await unrelated.exited;
    }
    expect(access(session.owned)).rejects.toThrow();
    expect(() => process.kill(firefoxPid, 0)).toThrow();
    expect(() => process.kill(chromiumPid, 0)).toThrow();
  },
  90000,
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
