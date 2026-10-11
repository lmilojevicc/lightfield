import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { FontsFixtureOptions, FontsFixtureStats } from "./fixture";

// Opt-in: one disposable browser, mounting real Fonts and SettingsShell with owned services.
const binary = process.env.LIGHTFIELD_UI_HEADLESS_CHROME;
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
class CDP {
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (!message.id) return;
      const ticket = this.pending.get(message.id);
      if (!ticket) return;
      clearTimeout(ticket.timer);
      this.pending.delete(message.id);
      if (message.error) ticket.reject(new Error(message.error.message));
      else ticket.resolve(message.result);
    };
  }
  command(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result: { value: T }; exceptionDetails?: unknown };
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() {
    for (const ticket of this.pending.values()) clearTimeout(ticket.timer);
    this.socket.close();
  }
}

test.skipIf(!binary)(
  "mounted Fonts: layout, mobile geometry, tabs, focus and saved-font Retry ownership",
  async () => {
    if (!binary) throw new Error("Explicit headless binary required");
    const built = await build({
      configFile: false,
      logLevel: "error",
      plugins: [svelte()],
      build: {
        write: false,
        lib: {
          entry: resolve("tests/ui/fonts/fixture.ts"),
          formats: ["es"],
          fileName: "fixture",
        },
      },
    });
    const bundle = Array.isArray(built) ? built[0] : built;
    if (!bundle || !("output" in bundle))
      throw new Error("Unexpected fixture bundle");
    const files = new Map(
      bundle.output.map((file) => [
        file.fileName,
        file.type === "chunk" ? file.code : file.source,
      ]),
    );
    const css = bundle.output
      .filter((file) => file.fileName.endsWith(".css"))
      .map((file) => `<link rel="stylesheet" href="/${file.fileName}">`)
      .join("");
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">${css}</head><body><script type="module" src="/fixture.js"></script></body></html>`;
    const profile = await mkdtemp(join(tmpdir(), "lightfield-fonts-headless-"));
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname.slice(1);
        if (!path)
          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        const value = files.get(path);
        return value === undefined
          ? new Response(null, { status: 404 })
          : new Response(
              typeof value === "string"
                ? value
                : new TextDecoder().decode(value),
              {
                headers: {
                  "Content-Type": path.endsWith(".js")
                    ? "text/javascript"
                    : "text/css",
                },
              },
            );
      },
    });
    const process = Bun.spawn(
      [
        binary,
        "--headless=new",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    let cdp: CDP | undefined;
    try {
      let port = "";
      for (let n = 0; n < 100 && !port; n++) {
        try {
          port =
            (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split(
              "\n",
            )[0] ?? "";
        } catch {
          await wait(50);
        }
      }
      if (!port) throw new Error("Headless Chrome did not start");
      // A loaded machine can answer /json/list before Chrome created its page,
      // so retry the target lookup within the same bounded startup budget.
      let target: { type: string; webSocketDebuggerUrl: string } | undefined;
      for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
        try {
          const targets = (await (
            await fetch(`http://127.0.0.1:${port}/json/list`)
          ).json()) as { type: string; webSocketDebuggerUrl: string }[];
          target = targets.find((item) => item.type === "page");
        } catch {
          // The endpoint can also refuse while Chrome is still starting.
        }
        if (!target) await wait(50);
      }
      if (!target) throw new Error("Missing owned page");
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      cdp = new CDP(socket);
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("CDP connection timed out"));
        }, 5000);
        socket.onopen = () => {
          clearTimeout(timer);
          done();
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error("CDP connection failed"));
        };
      });
      const browser = cdp;
      const evaluate = <T>(script: string) => browser.evaluate<T>(script);
      async function until(script: string, attempts = 100) {
        for (let n = 0; n < attempts; n++) {
          if (await evaluate<boolean>(script)) return;
          await wait(30);
        }
        throw new Error(`Condition timed out: ${script}`);
      }
      const stats = () =>
        evaluate<FontsFixtureStats>("window.fontsFixture.stats()");
      async function reset(options: FontsFixtureOptions) {
        await evaluate(`window.fontsFixture.reset(${JSON.stringify(options)})`);
        await until(
          `document.querySelector('#font-tab-${options.custom ? "custom" : "presets"}').getAttribute('aria-selected') === 'true'`,
        );
        await wait(350); // Existing presentation transition; no animation changes.
      }
      async function click(selector: string) {
        const point = await evaluate<{ x: number; y: number }>(
          `(()=>{ const e=document.querySelector(${JSON.stringify(selector)}); if(!e.checkVisibility())throw new Error('Not visible: ${selector}'); e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
        );
        await browser.command("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...point,
          button: "left",
          clickCount: 1,
        });
        await browser.command("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...point,
          button: "left",
          clickCount: 1,
        });
        await wait(40);
      }
      async function key(key: string) {
        await browser.command("Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          code: key,
        });
        await browser.command("Input.dispatchKeyEvent", {
          type: "keyUp",
          key,
          code: key,
        });
        await wait(40);
      }
      async function selected(tab: "presets" | "custom", focused = false) {
        expect(
          await evaluate<boolean>(
            `document.querySelector('#font-tab-${tab}').getAttribute('aria-selected') === 'true'`,
          ),
        ).toBe(true);
        expect(
          await evaluate<boolean>(
            `document.querySelector('#font-panel-${tab}').checkVisibility()`,
          ),
        ).toBe(true);
        expect(
          await evaluate<boolean>(
            `document.querySelector('#font-panel-${tab === "custom" ? "presets" : "custom"}').checkVisibility()`,
          ),
        ).toBe(false);
        expect(
          await evaluate<boolean>(`(() => {
            const panel = document.querySelector('#panel-fonts');
            const bar = panel.querySelector('[role="tablist"]');
            const buttons = [...bar.querySelectorAll('[role="tab"]')];
            const tabs = buttons.map(e => parseFloat(getComputedStyle(e).width));
            const style = getComputedStyle(bar);
            const available = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            return Math.abs(tabs[0] - tabs[1]) < 1
              && Math.abs(tabs[0] + tabs[1] + parseFloat(style.columnGap) - available) < 1
              && Math.abs(bar.offsetWidth - panel.clientWidth) < 1
              && bar.offsetHeight === 44
              && buttons.every(e => e.offsetHeight === 36
                && parseFloat(getComputedStyle(e).paddingLeft) === 10
                && parseFloat(getComputedStyle(e).fontSize) === 13);
          })()`),
        ).toBe(true);
        if (focused)
          expect(await evaluate<string>("document.activeElement.id")).toBe(
            `font-tab-${tab}`,
          );
      }
      async function specimenAfter(selector: string) {
        expect(
          await evaluate<boolean>(`(() => {
            const controls = document.querySelector(${JSON.stringify(selector)});
            const specimen = document.querySelector('#specimen-card');
            return !!(controls.compareDocumentPosition(specimen) & Node.DOCUMENT_POSITION_FOLLOWING)
              && specimen.getBoundingClientRect().top >= controls.getBoundingClientRect().bottom;
          })()`),
        ).toBe(true);
      }
      async function noIdleFiller() {
        expect(
          await evaluate<boolean>(`(() => {
            const panel = document.querySelector('#panel-fonts');
            const idle = ['current-font-status', 'custom-font-status', 'display-font-status', 'body-font-status'];
            return !panel.textContent.includes('· works offline')
              && !panel.textContent.includes('Draft · preview before applying. Current fonts unchanged.')
              && idle.every(id => {
                const status = document.getElementById(id);
                return status.textContent.trim() === ''
                  && status.getBoundingClientRect().height === 0
                  && status.getAttribute('role') === 'status'
                  && status.getAttribute('aria-live') === 'polite';
              });
          })()`),
        ).toBe(true);
      }
      await browser.command("Page.enable");
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await browser.command("Page.navigate", {
        url: `http://127.0.0.1:${String(server.port)}/`,
      });
      await until(
        "!!window.fontsFixture && !!document.querySelector('#font-tab-presets')",
      );

      for (const width of [320, 360, 390, 430]) {
        await browser.command("Emulation.setDeviceMetricsOverride", {
          width,
          height: 568,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await browser.command("Emulation.setTouchEmulationEnabled", {
          enabled: true,
        });
        expect(
          await evaluate<boolean>("matchMedia('(pointer: coarse)').matches"),
        ).toBe(true);
        for (const presentation of ["modal", "drawer"] as const) {
          await reset({ presentation });
          await specimenAfter("#modal-font-grid");
          await noIdleFiller();
          for (const tab of ["presets", "custom"] as const) {
            if (tab === "custom") await click("#font-tab-custom");
            await selected(tab);
            await noIdleFiller();
            await specimenAfter(
              tab === "presets"
                ? "#modal-font-grid"
                : "#custom-font-draft-actions",
            );
            if (tab === "custom") await specimenAfter("#custom-font-controls");
            const geometry = await evaluate<{
              overflow: string[];
              navWidth: number;
              padding: number;
              fieldsInView: boolean;
              touchTargetsFit: boolean;
              clockSize: number;
              scrollable: boolean;
              specimenReachable: boolean;
            }>(`(() => {
              const content = document.querySelector('.settings-content');
              content.scrollTop = 0;
              const viewport = content.getBoundingClientRect();
              const panel = document.querySelector('#panel-fonts');
              const visible = [...panel.querySelectorAll('button, input, .specimen-card, .specimen-clock, .specimen-date, .specimen-text')]
                .filter(e => e.checkVisibility());
              const overflow = visible.filter(e => {
                const r = e.getBoundingClientRect();
                return r.left < viewport.left - 1 || r.right > viewport.right + 1
                  || e.scrollWidth > e.clientWidth + 1;
              }).map(e => e.id || e.className);
              if (content.scrollWidth > content.clientWidth + 1) overflow.push('settings-content');
              if (document.documentElement.scrollWidth > innerWidth) overflow.push('document');
              const fieldsInView = ['custom-display-font', 'custom-body-font'].every(id => {
                const r = document.getElementById(id).getBoundingClientRect();
                return r.top >= viewport.top && r.bottom <= viewport.bottom && r.height >= 44;
              });
              const touchTargetsFit = visible.filter(e => e.matches('button, input')).every(e => {
                const r = e.getBoundingClientRect();
                const minimumHeight = e.matches('#panel-fonts > [role="tablist"] > [role="tab"]') ? 36 : 44;
                return r.height >= minimumHeight && r.width >= 44;
              });
              const nav = document.querySelector('.settings-nav');
              const navWidth = nav.getBoundingClientRect().width;
              const padding = parseFloat(getComputedStyle(content).paddingLeft);
              const clockSize = parseFloat(getComputedStyle(document.querySelector('#specimen-clock')).fontSize);
              content.scrollTop = content.scrollHeight;
              const specimen = document.querySelector('#specimen-card').getBoundingClientRect();
              return {
                overflow, navWidth, padding, fieldsInView, touchTargetsFit, clockSize,
                scrollable: getComputedStyle(content).overflowY === 'auto'
                  && (content.scrollHeight <= content.clientHeight || content.scrollTop > 0),
                specimenReachable: specimen.bottom <= viewport.bottom + 1 && specimen.top >= viewport.top - 1,
              };
            })()`);
            expect(geometry.overflow).toEqual([]);
            expect(geometry.navWidth).toBeLessThanOrEqual(52);
            expect(geometry.padding).toBeLessThanOrEqual(12);
            expect(geometry.clockSize).toBeLessThanOrEqual(30);
            if (width === 320) expect(geometry.clockSize).toBeLessThan(30);
            expect(geometry.touchTargetsFit).toBe(true);
            expect(geometry.scrollable).toBe(true);
            expect(geometry.specimenReachable).toBe(true);
            if (tab === "custom") {
              expect(geometry.fieldsInView).toBe(true);
              // A real pointer click remains usable after scrolling to the specimen.
              await click("#custom-font-preview-button");
              await until(
                "!document.querySelector('#specimen-draft-note').hidden",
              );
              expect((await stats()).previews).toBe(1);
              await specimenAfter("#custom-font-draft-actions");
            }
            console.log(
              `Mounted ${presentation} ${String(width)}px ${tab}: ordering, idle regions, overflow, controls and scroll reachability passed`,
            );
          }
        }
      }
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });

      await browser.command("Emulation.setTouchEmulationEnabled", {
        enabled: false,
      });
      for (const presentation of ["modal", "drawer"] as const) {
        await reset({ presentation });
        await selected("presets");
        await specimenAfter("#modal-font-grid");
        await noIdleFiller();
        expect(
          await evaluate<number>(
            "parseFloat(getComputedStyle(document.querySelector('#specimen-clock')).fontSize)",
          ),
        ).toBe(30);
        expect(
          await evaluate<number>(
            "document.querySelector('.settings-nav').getBoundingClientRect().width",
          ),
        ).toBe(presentation === "modal" ? 195 : 0);
        expect(
          await evaluate<string>(
            "document.querySelector('#settings-sheet').dataset.presentation",
          ),
        ).toBe(presentation);
        expect(
          await evaluate<boolean>(
            "document.querySelector('#modal-font-grid').checkVisibility() && !document.querySelector('#custom-display-font').checkVisibility()",
          ),
        ).toBe(true);
        await click("#font-tab-custom");
        await selected("custom", true);
        await specimenAfter("#custom-font-controls");
        await specimenAfter("#custom-font-draft-actions");
        await noIdleFiller();
        expect((await stats()).previews).toBe(0);
        expect((await stats()).retries).toBe(0);
        expect((await stats()).consent).toBe(0);
        await key("ArrowRight");
        await selected("presets", true);
        await key("ArrowLeft");
        await selected("custom", true);
        await key("Home");
        await selected("presets", true);
        await key("End");
        await selected("custom", true);
        await key("Tab");
        expect(await evaluate<string>("document.activeElement.id")).toBe(
          "font-panel-custom",
        );
        await key("Tab");
        expect(await evaluate<string>("document.activeElement.id")).toBe(
          "custom-display-font",
        );
        await click("#custom-font-preview-button");
        await until("!document.querySelector('#specimen-draft-note').hidden");
        expect((await stats()).previews).toBe(1);
        expect((await stats()).consent).toBe(0);
        expect((await stats()).saves).toBe(0);
        await click("#custom-font-cancel");
        await selected("presets", true);
        expect((await stats()).disposed).toBe(1);
        expect(
          await evaluate<boolean>(
            "document.querySelector('#specimen-draft-note').hidden",
          ),
        ).toBe(true);
        await click("#font-tab-custom");
        await click("#custom-font-preview-button");
        await until("!document.querySelector('#specimen-draft-note').hidden");
        await click("#font-tab-presets");
        expect((await stats()).disposed).toBe(2);
        expect((await stats()).saves).toBe(0);
        await evaluate(
          "window.fontsFixture.close();window.fontsFixture.reopen()",
        );
        await selected("presets");
        await reset({ presentation, custom: true });
        await selected("custom");
        await click("#custom-font-cancel");
        await selected("presets");
        await evaluate("window.fontsFixture.close()");
        await wait(40);
        await evaluate("window.fontsFixture.reopen()");
        await wait(40);
        await selected("custom");
        expect(
          await evaluate<string>(
            "document.querySelector('#custom-display-font').value",
          ),
        ).toBe("Georgia");
        console.log(
          `Mounted ${presentation}: native tab focus, visibility, offline preview/cancel, disposal and selected-mode reopen passed`,
        );
      }

      await reset({ custom: true, failSaved: true, holdRetry: true });
      await selected("custom");
      expect(
        await evaluate<boolean>(
          "document.querySelector('#custom-font-retry').checkVisibility()",
        ),
      ).toBe(true);
      expect((await stats()).retries).toBe(0);
      await click("#custom-font-retry");
      expect((await stats()).retries).toBe(1);
      expect((await stats()).consent).toBe(0);
      expect(
        await evaluate<string>(
          "document.querySelector('#custom-display-font').value",
        ),
      ).toBe("Georgia");
      expect((await stats()).saves).toBe(0);
      await until(
        "document.querySelector('#current-font-status').textContent.includes('Loading saved')",
      );
      await evaluate("window.fontsFixture.finishRetry(true)");
      await until(
        "!!document.querySelector('#custom-font-retry') && !document.querySelector('#custom-font-retry').disabled",
      );
      expect(
        await evaluate<string>(
          "document.querySelector('#custom-font-status').textContent",
        ),
      ).toContain("Owned retry rejection");
      await click("#custom-font-retry");
      expect((await stats()).retries).toBe(2);
      await evaluate("window.fontsFixture.finishRetry()");
      await until(
        "document.querySelector('#current-font-status').textContent.includes('Custom fonts ready')",
      );
      expect(
        await evaluate<boolean>(
          "!document.querySelector('#custom-font-retry')",
        ),
      ).toBe(true);
      console.log(
        "Saved offline load failure: Retry reachable, rejection actionable, second retry recovers without applying draft",
      );

      await reset({
        custom: true,
        remote: true,
        failSaved: true,
        holdConsent: true,
      });
      // Change draft to offline names: Retry must still authorize SAVED remote pairing.
      await evaluate(
        "{const input=document.querySelector('#custom-display-font');input.value='Georgia';input.dispatchEvent(new Event('input',{bubbles:true}))}",
      );
      await click("#custom-font-retry");
      expect((await stats()).consent).toBe(1);
      expect((await stats()).retries).toBe(0);
      expect(
        await evaluate<boolean>(
          "document.querySelector('#custom-font-retry').disabled",
        ),
      ).toBe(true);
      await evaluate("window.fontsFixture.consent(false)");
      await until("!document.querySelector('#custom-font-retry').disabled");
      expect((await stats()).retries).toBe(0);
      expect(
        await evaluate<string>(
          "document.querySelector('#custom-font-status').textContent",
        ),
      ).toContain("permission is required");
      await click("#custom-font-retry");
      await click("#font-tab-presets");
      await evaluate("window.fontsFixture.consent(true)");
      await wait(40);
      expect((await stats()).retries).toBe(0);
      await selected("presets", true);
      console.log(
        "Saved remote Retry: saved-name consent, denial and tab-switch invalidation passed",
      );

      await reset({
        custom: true,
        remote: true,
        failSaved: true,
        holdConsent: true,
      });
      await click("#custom-font-retry");
      await evaluate("window.fontsFixture.consent(true)");
      await until(
        "document.querySelector('#current-font-status').textContent.includes('Custom fonts ready')",
      );
      expect((await stats()).consent).toBe(1);
      expect((await stats()).retries).toBe(1);
      expect((await stats()).saves).toBe(0);

      await reset({
        custom: true,
        remote: true,
        failSaved: true,
        holdConsent: true,
      });
      await click("#custom-font-retry");
      await evaluate("window.fontsFixture.close()");
      await evaluate("window.fontsFixture.consent(true)");
      await wait(40);
      expect((await stats()).retries).toBe(0);
      expect(
        await evaluate<boolean>(
          "document.querySelector('#settings-sheet').classList.contains('is-open')",
        ),
      ).toBe(false);
      console.log(
        "Saved remote Retry: explicit approval calls Retry once; session close cancels pending authorization",
      );

      await reset({ custom: true, failSaved: true });
      await evaluate(
        "{const input=document.querySelector('#custom-display-font');input.value='Arial';input.dispatchEvent(new Event('input',{bubbles:true}))}",
      );
      await click("#custom-font-preview-button");
      await until("!document.querySelector('#specimen-draft-note').hidden");
      await click("#custom-font-retry");
      await until(
        "document.querySelector('#current-font-status').textContent.includes('Custom fonts ready')",
      );
      expect((await stats()).previews).toBe(1);
      expect((await stats()).disposed).toBe(0);
      expect((await stats()).display).toBe("Georgia");
      expect((await stats()).saves).toBe(0);
      expect(
        await evaluate<string>(
          "document.querySelector('#custom-display-font').value",
        ),
      ).toBe("Arial");
      expect(
        await evaluate<boolean>(
          "document.querySelector('#specimen-draft-note').checkVisibility()",
        ),
      ).toBe(true);
      console.log(
        "Saved Retry retains separately owned draft preview and editable names; no draft write",
      );

      await reset({ custom: true, failSaved: true, holdPreview: true });
      await click("#custom-font-preview-button");
      expect(
        await evaluate<boolean>(
          "document.querySelector('#custom-font-retry').disabled",
        ),
      ).toBe(true);
      await evaluate("window.fontsFixture.finishPreview()");
      await until("!document.querySelector('#custom-font-retry').disabled");
      expect((await stats()).retries).toBe(0);

      await reset({ custom: true, failSaved: true, holdSave: true });
      await click("#custom-font-preview-button");
      await until("!document.querySelector('#custom-font-apply').disabled");
      await click("#custom-font-apply");
      expect((await stats()).saves).toBe(1);
      expect((await stats()).blocked).toBe(true);
      expect(
        await evaluate<boolean>(
          "document.querySelector('#custom-font-retry').disabled",
        ),
      ).toBe(true);
      await click("#font-tab-presets");
      await selected("custom");
      await key("Escape");
      await selected("custom");
      expect(
        await evaluate<boolean>(
          "document.querySelector('#settings-sheet').classList.contains('is-open')",
        ),
      ).toBe(true);
      await until(
        "document.querySelector('#custom-font-status').textContent.includes('taking longer')",
        400,
      );
      expect((await stats()).blocked).toBe(false);
      expect(
        await evaluate<boolean>(
          "document.querySelector('#custom-font-retry').disabled",
        ),
      ).toBe(true);
      await click("#font-tab-presets");
      await selected("custom");
      await evaluate("window.fontsFixture.close()");
      await evaluate("window.fontsFixture.finishSave()");
      await wait(60);
      expect((await stats()).retries).toBe(0);
      expect((await stats()).display).toBe("Georgia");
      console.log(
        "Preview-loading and save Retry guards passed; ten-second barrier allowed close, never inner navigation or Retry",
      );
    } finally {
      cdp?.close();
      process.kill();
      await process.exited;
      await server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  60000,
);
