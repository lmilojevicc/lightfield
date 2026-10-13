import { watch, type FSWatcher } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { root } from "./paths";
import { developmentGeckoId } from "./manifest";
import {
  firefoxArguments,
  RebuildQueue,
  waitForBrowser,
} from "./dev-lifecycle";
import {
  chromiumModule,
  createChromiumLaunch,
  createFirefoxConnection,
  findFirefoxPort,
  type ChromiumRunner,
  type FirefoxRemote,
} from "./web-ext";

import { resolveManagedBinary } from "./managed-browsers";
import { DevelopmentInputs, developmentInputs } from "./dev-inputs";

import { seedDevThemes } from "./dev-theme-fixtures";

export async function launchBrowsers(
  headless: boolean,
  options: { fixtures?: boolean } = {},
) {
  const owned = await mkdtemp(resolve(tmpdir(), "lightfield-dev-"));
  const live = resolve(owned, "extension");
  let chromium: ChromiumRunner | undefined;
  let firefox: ReturnType<typeof Bun.spawn> | undefined;
  let remote: FirefoxRemote | undefined;
  let build: ReturnType<typeof Bun.spawn> | undefined;
  const cancellation = new AbortController();
  const ownedChromium = createChromiumLaunch(cancellation.signal);
  let connectingFirefox: ReturnType<typeof createFirefoxConnection> | undefined;
  let ready = false;
  let startupFailure: Error | undefined;
  let explicitCancellation = false;
  const wasCancelled = () => explicitCancellation;
  let stopped = false;
  const isStopped = () => stopped;
  let finishStartup!: () => void;
  const startupDone = new Promise<void>((resolve) => {
    finishStartup = resolve;
  });
  let shutdown: Promise<void> | undefined;
  const watchers: FSWatcher[] = [];
  const stop = (): Promise<void> => {
    shutdown ??= (async () => {
      stopped = true;
      for (const watcher of watchers) watcher.close();
      cancellation.abort(
        startupFailure ?? new Error("Developer launcher cancelled"),
      );
      build?.kill("SIGKILL");
      connectingFirefox?.disconnect();
      remote?.disconnect();
      firefox?.kill();
      if (chromium) chromium.exiting = true;
      ownedChromium.terminate();
      try {
        await startupDone;
        await queue.stop();
        if (build)
          await waitForBrowser(build.exited, "Build shutdown", undefined, 5000);
        if (firefox) {
          try {
            await waitForBrowser(
              firefox.exited,
              "Firefox shutdown",
              undefined,
              2000,
            );
          } catch {
            firefox.kill("SIGKILL");
            await waitForBrowser(
              firefox.exited,
              "Firefox forced shutdown",
              undefined,
              5000,
            );
          }
        }
        if (chromium)
          await waitForBrowser(
            chromium.exit(),
            "Chromium adapter shutdown",
            undefined,
            5000,
          );
      } finally {
        await rm(owned, { recursive: true, force: true });
        process.off("SIGINT", signal);
        process.off("SIGTERM", signal);
      }
    })();
    return shutdown;
  };
  const signal = () => {
    explicitCancellation = true;
    void stop().catch(console.error);
  };
  process.on("SIGINT", signal);
  process.on("SIGTERM", signal);
  const compile = async () => {
    const stage = resolve(owned, "stage");
    await rm(stage, { recursive: true, force: true });
    if (isStopped()) return;
    build = Bun.spawn([process.execPath, "tooling/build.ts"], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "production",
        LIGHTFIELD_DEV_BUILD_DIRECTORY: stage,
      },
      stdout: "inherit",
      stderr: "inherit",
      timeout: 120000,
      killSignal: "SIGKILL",
    });
    const result = await build.exited;
    if (isStopped()) return;
    if (result !== 0)
      throw new Error(
        "Build failed; keeping the last working extension. Watching for fixes.",
      );
    if (chromium) {
      for (const target of ["chromium", "firefox"]) {
        if (
          (await readFile(resolve(stage, target, "manifest.json"), "utf8")) !==
          (await readFile(resolve(live, target, "manifest.json"), "utf8"))
        ) {
          throw new Error(
            "Manifest changed: restart bun run dev:browsers to apply permissions/identity changes. Keeping the working build.",
          );
        }
      }
      await rename(live, resolve(owned, "previous"));
    }
    try {
      await rename(stage, live);
    } catch (error) {
      if (chromium) await rename(resolve(owned, "previous"), live);
      throw error;
    }
    await rm(resolve(owned, "previous"), { recursive: true, force: true });
  };
  let readyReload: (() => Promise<void>) | undefined;
  const inputs = new DevelopmentInputs(root);
  const queue = new RebuildQueue(async () => {
    await startupDone;
    if (!isStopped() && (await inputs.changed())) await readyReload?.();
  }, console.error);
  try {
    const chromiumBinary = await resolveManagedBinary(
      "chromium",
      cancellation.signal,
    );
    const firefoxBinary = await resolveManagedBinary(
      "firefox",
      cancellation.signal,
    );
    cancellation.signal.throwIfAborted();
    await inputs.changed();
    cancellation.signal.throwIfAborted();
    for (const path of developmentInputs) {
      watchers.push(
        watch(resolve(root, path), { recursive: true }, () => {
          queue.request();
        }),
      );
    }

    await compile();
    if (isStopped()) {
      if (startupFailure) throw startupFailure;
      return { stop, owned };
    }
    const chromiumProfile = resolve(owned, "chromium-profile");
    await mkdir(chromiumProfile);
    chromium = new chromiumModule.ChromiumExtensionRunner({
      chromiumBinary,
      chromiumLaunch: ownedChromium.launch,
      chromiumProfile,
      keepProfileChanges: true,
      extensions: [{ sourceDir: resolve(live, "chromium") }],
      startUrl: "about:blank",
      args: headless ? ["--headless=new"] : [],
    });
    chromium.registerCleanup(() => {
      if (!isStopped()) void stop().catch(console.error);
    });
    cancellation.signal.throwIfAborted();
    await waitForBrowser(
      chromium.run(),
      "Chromium setup",
      cancellation.signal,
      30000,
    );
    const activeChromium = chromium;
    const send = (
      ...args: Parameters<ChromiumRunner["cdp"]["sendCommand"]>
    ) => {
      cancellation.signal.throwIfAborted();
      return waitForBrowser(
        activeChromium.cdp.sendCommand(...args),
        `Chromium ${args[0]}`,
        cancellation.signal,
      );
    };
    if (isStopped()) {
      await chromium.exit();
      return { stop, owned };
    }
    const loaded = await send("Extensions.loadUnpacked", {
      path: resolve(live, "chromium"),
    });
    if (!loaded.id)
      throw new Error(
        "Chromium did not return an unpacked extension ID; use current Chromium or Chrome for Testing.",
      );
    const chromiumUrl = `chrome-extension://${loaded.id}/newtab.html`;
    const targets = await send("Target.getTargets", {});
    const initial = targets.targetInfos?.find(
      (tab) => tab.type === "page" && tab.url === "about:blank",
    );
    if (!initial) throw new Error("Missing owned Chromium startup tab");
    const attached = await send("Target.attachToTarget", {
      targetId: initial.targetId,
      flatten: true,
    });
    await send("Page.navigate", { url: chromiumUrl }, attached.sessionId);

    if (options.fixtures !== false) {
      // Navigation is asynchronous in CDP; never evaluate in about:blank.
      let navigated = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await send(
          "Runtime.evaluate",
          { expression: "location.href", returnByValue: true },
          attached.sessionId,
        );
        if (result.result?.value === chromiumUrl) {
          navigated = true;
          break;
        }
        await Bun.sleep(100);
      }
      if (!navigated)
        throw new Error("Chromium fixture page navigation timed out");
      await seedDevThemes(async (expression) => {
        const result = await send(
          "Runtime.evaluate",
          { expression, returnByValue: true },
          attached.sessionId,
        );
        return result.result?.value;
      }, cancellation.signal);
    }
    await send("Target.detachFromTarget", {
      sessionId: attached.sessionId,
    });
    const firefoxProfile = resolve(owned, "firefox-profile");
    await mkdir(firefoxProfile);
    const prefs = {
      "devtools.debugger.remote-enabled": true,
      "devtools.chrome.enabled": true,
      "devtools.debugger.prompt-connection": false,
      "devtools.debugger.force-local": true,
      "browser.shell.checkDefaultBrowser": false,
      "browser.startup.homepage_override.mstone": "ignore",
      "browser.aboutwelcome.enabled": false,
      "browser.newtabpage.enabled": true,
      "extensions.autoDisableScopes": 0,
      "termsofuse.bypassNotification": true,
      "datareporting.policy.dataSubmissionEnabled": false,
      "browser.dom.window.dump.enabled": true,
    };
    await writeFile(
      resolve(firefoxProfile, "user.js"),
      Object.entries(prefs)
        .map(
          ([key, value]) =>
            `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
        )
        .join("\n"),
    );
    const port = await waitForBrowser(
      findFirefoxPort(),
      "Firefox debugger port",
      cancellation.signal,
    );
    cancellation.signal.throwIfAborted();
    firefox = Bun.spawn(
      [firefoxBinary, ...firefoxArguments(firefoxProfile, port, headless)],
      {
        env: { ...process.env, ...(headless ? { MOZ_HEADLESS: "1" } : {}) },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const firefoxProcess = firefox;
    void firefox.exited.then((code) => {
      if (isStopped()) return;
      if (!ready)
        startupFailure = new Error(
          `Firefox exited before readiness (exit code ${String(code)}, signal ${String(firefoxProcess.signalCode)}). Check LIGHTFIELD_FIREFOX_BINARY and browser startup diagnostics.`,
        );
      void stop().catch(console.error);
    });
    const firefoxDeadline = Date.now() + 30000;
    let tcpReady = false;
    for (
      let attempt = 0;
      Date.now() < firefoxDeadline && !isStopped();
      attempt++
    ) {
      try {
        await waitForBrowser(
          new Promise<void>((resolve, reject) => {
            const socket = createConnection({ host: "127.0.0.1", port });
            socket.once("connect", () => {
              socket.destroy();
              resolve();
            });
            const close = () => {
              socket.destroy();
              reject(new Error("Firefox connection cancelled"));
            };
            cancellation.signal.addEventListener("abort", close, {
              once: true,
            });
            socket.setTimeout(1000, () => {
              socket.destroy();
              reject(new Error("Firefox TCP probe timed out"));
            });
            socket.once("close", () => {
              cancellation.signal.removeEventListener("abort", close);
            });
            socket.once("error", (error) => {
              socket.destroy();
              reject(error);
            });
          }),
          "Firefox TCP connection",
          cancellation.signal,
          2000,
        );
        tcpReady = true;
        break;
      } catch (error) {
        connectingFirefox?.disconnect();
        if (cancellation.signal.aborted) throw error;
        if (attempt === 149) console.error(error);
        await Bun.sleep(200);
      }
    }
    if (isStopped()) {
      if (startupFailure) throw startupFailure;
      return { stop, owned };
    }
    if (!tcpReady)
      throw new Error("Firefox debugger did not start within 30 seconds.");
    connectingFirefox = createFirefoxConnection();
    await waitForBrowser(
      connectingFirefox.connect(port),
      "Firefox root handshake",
      cancellation.signal,
      5000,
    );
    remote = connectingFirefox.remote;
    const activeFirefox = remote;
    const request = (packet: string | Record<string, unknown>) => {
      cancellation.signal.throwIfAborted();
      return waitForBrowser(
        activeFirefox.client.request(packet),
        "Firefox protocol request",
        cancellation.signal,
      );
    };
    const listTabs = async () => {
      const response = await request("listTabs");
      if (!Array.isArray(response.tabs))
        throw new Error(
          `Firefox listTabs returned a malformed response (expected a tabs array): ${JSON.stringify(response)}. Restart bun run dev; if this persists, check Firefox/web-ext protocol compatibility.`,
        );
      return response.tabs as {
        actor: string;
        url: string;
        traits?: { supportsNavigation?: boolean };
      }[];
    };
    await waitForBrowser(
      remote.installTemporaryAddon(resolve(live, "firefox"), false),
      "Firefox temporary installation",
      cancellation.signal,
    );
    const addon = await waitForBrowser(
      remote.getInstalledAddon(developmentGeckoId),
      "Firefox installed addon",
      cancellation.signal,
    );
    const firefoxUrl = new URL("newtab.html", addon.manifestURL).href;
    const tabs = await listTabs();
    const tab = tabs.find((tab) => tab.url === "about:blank");
    if (!tab) throw new Error("Missing owned Firefox startup tab");
    if (!tab.traits?.supportsNavigation)
      throw new Error(
        "Use Firefox 140 or newer: this launcher needs non-activating tab navigation/reload support.",
      );
    // Installing a new-tab override can finish replacing the startup tab after
    // temporary installation resolves. Verify navigation rather than reporting a blank preview.
    for (let attempt = 0; attempt < 5; attempt++) {
      await request({
        to: tab.actor,
        type: "navigateTo",
        url: firefoxUrl,
        waitForLoad: true,
      });
      await Bun.sleep(400);
      const navigated = await listTabs();
      if (navigated.some((page) => page.url === firefoxUrl)) break;
      if (attempt === 4)
        throw new Error(
          "Firefox could not open the installed lightfield new-tab page.",
        );
    }
    if (options.fixtures !== false) {
      const target = (await request({ to: tab.actor, type: "getTarget" })) as {
        frame: { webExtensionInspectedWindowActor: string };
      };
      await seedDevThemes(async (expression) => {
        const response = (await request({
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
          throw new Error(
            `Firefox fixture evaluation failed: ${JSON.stringify(response.evalResult.exceptionInfo)}`,
          );
        return response.evalResult.value;
      }, cancellation.signal);
    }
    const extensionId = loaded.id;
    const reload = async () => {
      await compile();
      if (isStopped()) return;
      const pages = await send("Target.getTargets", {});
      for (const page of pages.targetInfos ?? []) {
        if (
          page.type !== "page" ||
          !page.url.startsWith(`chrome-extension://${extensionId}/`)
        )
          continue;
        const session = await send("Target.attachToTarget", {
          targetId: page.targetId,
          flatten: true,
        });
        try {
          await send("Page.reload", { ignoreCache: true }, session.sessionId);
        } finally {
          await send("Target.detachFromTarget", {
            sessionId: session.sessionId,
          });
        }
      }
      const currentTabs = await listTabs();
      for (const page of currentTabs) {
        if (!page.url.startsWith(new URL(".", firefoxUrl).href)) continue;
        await request({
          to: page.actor,
          type: "reloadDescriptor",
          bypassCache: true,
        });
      }
      console.log(
        "lightfield: rebuilt both targets; reloaded owned extension pages (no activation).",
      );
    };
    readyReload = async () => {
      try {
        await reload();
      } catch (error) {
        // A protocol timeout is not a compile failure: stop the unusable owned pair.
        if (error instanceof Error && error.message.includes("timed out"))
          void stop().catch(console.error);
        throw error;
      }
    };
    ready = true;
    console.log(
      `lightfield ready (${headless ? "headless" : "visible"}). Owned temporary data: ${owned}\nWatching; Ctrl+C to close only these browsers. Manifest changes require restart.`,
    );
    return { stop, owned, chromium, remote, firefox, chromiumUrl, firefoxUrl };
  } catch (error) {
    finishStartup();
    await stop();
    if (startupFailure) throw startupFailure;
    if (wasCancelled()) return { stop, owned };
    throw error;
  } finally {
    finishStartup();
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: bun run dev [--headless] [--no-fixtures]\nDevelopment custom themes are seeded once in disposable owned profiles; --no-fixtures leaves the collection empty. Selection is unchanged.\nBuild and watch both MV3 targets in isolated Chromium/CfT and Firefox profiles.\nVisible by default; --headless is for automation. Ctrl+C cleans up owned browsers/data.\nFirst run downloads pinned Chrome for Testing + Firefox into the lightfield OS user cache; later runs reuse it without provisioning network.\nOptional strict LIGHTFIELD_CHROMIUM_BINARY / LIGHTFIELD_FIREFOX_BINARY executable overrides. Linux needs browser OS libraries; extraction tools and a desktop/display are prerequisites. Manifest changes require restart; successful page builds reload without focus.",
    );
  } else if (
    args.some((arg) => arg !== "--headless" && arg !== "--no-fixtures")
  ) {
    console.error("Unknown option. Use bun run dev:browsers --help.");
    process.exitCode = 1;
  } else {
    try {
      await launchBrowsers(args.includes("--headless"), {
        fixtures: !args.includes("--no-fixtures"),
      });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
}
