import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Opt-in production smoke owns only its disposable, explicitly headless browser.
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
  "headless production settings: dismissal, footer identity and presentation geometry",
  async () => {
    if (!binary) throw new Error("Explicit headless binary required");
    const profile = await mkdtemp(join(tmpdir(), "lightfield-ui-headless-"));
    const root = resolve("dist/chromium");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = resolve(root, `.${new URL(request.url).pathname}`);
        if (!path.startsWith(`${root}/`))
          return new Response(null, { status: 404 });
        const file = Bun.file(path);
        return (await file.exists())
          ? new Response(file)
          : new Response(null, { status: 404 });
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
      if (!port) throw new Error("Headless browser did not start");
      const targets = (await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const target = targets.find((item) => item.type === "page");
      if (!target) throw new Error("Missing disposable page");
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      cdp = new CDP(socket);
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("CDP connect timed out"));
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
      const click = async (selector: string) => {
        await evaluate(
          `document.querySelector(${JSON.stringify(selector)}).click()`,
        );
        await wait(60);
      };
      const pointer = (type: string, x: number, y: number) =>
        browser.command("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          button: "left",
          clickCount: 1,
        });
      const outside = async () => {
        await pointer("mousePressed", 20, 800);
        await pointer("mouseReleased", 20, 800);
        await wait(60);
      };
      async function nativeGesture(
        selector: string,
        startInside: boolean,
        endInside: boolean,
      ) {
        const inside = await evaluate<{ x: number; y: number }>(
          `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).querySelector('h2').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
        );
        await evaluate(
          `window.__gestureEvents=[];window.__gesturePanel=document.querySelector(${JSON.stringify(selector)});`,
        );
        const start = startInside ? inside : { x: 20, y: 800 };
        const end = endInside ? inside : { x: 20, y: 800 };
        await pointer("mousePressed", start.x, start.y);
        await pointer("mouseMoved", end.x, end.y);
        await pointer("mouseReleased", end.x, end.y);
        await wait(60);
        const events = await evaluate<{ type: string; inside: boolean }[]>(
          `window.__gestureEvents`,
        );
        expect(events.find((event) => event.type === "pointerup")?.inside).toBe(
          endInside,
        );
        expect(events.find((event) => event.type === "click")?.inside).toBe(
          startInside && endInside,
        );
        console.log(
          `Native ${selector} ${startInside ? "inside" : "outside"}→${endInside ? "inside" : "outside"}: ${JSON.stringify(events)}`,
        );
      }
      const opened = () =>
        evaluate<boolean>(
          `document.querySelector('#settings-sheet').classList.contains('is-open')`,
        );
      const tuner = () =>
        evaluate<boolean>(`!document.querySelector('#effect-tuner').hidden`);
      const bounds = () =>
        evaluate<{ x: number; y: number; width: number; height: number }>(
          `(()=>{const r=document.querySelector('.sheet__panel').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
        );
      await browser.command("Page.enable");
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await browser.command("Page.navigate", {
        url: `http://127.0.0.1:${String(server.port)}/newtab.html`,
      });
      await wait(1000);
      await evaluate(
        `for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{if(window.__gestureEvents)window.__gestureEvents.push({type,inside:event.composedPath().includes(window.__gesturePanel)})},true)`,
      );
      await click("#settings-open");
      await wait(350);
      expect(await opened()).toBe(true);
      await pointer("mousePressed", 500, 210);
      await pointer("mouseReleased", 500, 210);
      expect(await opened()).toBe(true);
      await nativeGesture(".sheet__panel", false, true);
      expect(await opened()).toBe(true);
      await nativeGesture(".sheet__panel", true, false);
      expect(await opened()).toBe(true);
      await nativeGesture(".sheet__panel", false, false);
      expect(await opened()).toBe(false);
      await click("#settings-open");
      await wait(350);
      await click('[data-settings-nav="background"]');
      expect(
        await evaluate<string[]>(
          `Array.from(document.querySelectorAll('#background-picker-options .bg-collection')).map(e=>e.dataset.backgroundGrid)`,
        ),
      ).toEqual([
        "meridian",
        "react-bits",
        "orbs",
        "neat",
        "paper",
        "pixel-perfect",
      ]);
      await evaluate(
        `window.__controls=document.querySelector('#background-controls');window.__reset=document.querySelector('#background-reset');window.__field=document.querySelector('#background-ink-opacity')`,
      );
      await click("#effect-tune");
      expect(await tuner()).toBe(true);
      expect(
        await evaluate<boolean>(
          `document.querySelector('#tuning-dock')===null && !document.querySelector('#settings-open').checkVisibility()`,
        ),
      ).toBe(true);
      expect(
        await evaluate<boolean>(
          `document.querySelectorAll('#background-reset').length===1 && document.querySelectorAll('#effect-tuner-return').length===1 && document.querySelector('#background-reset').parentElement===document.querySelector('#effect-tuner-return').parentElement`,
        ),
      ).toBe(true);
      expect(
        await evaluate<boolean>(
          `window.__controls===document.querySelector('#background-controls') && window.__field===document.querySelector('#background-ink-opacity') && window.__reset===document.querySelector('#background-reset')`,
        ),
      ).toBe(true);
      const slider = await evaluate<{ x: number; y: number }>(
        `(()=>{const r=window.__field.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
      );
      await pointer("mousePressed", slider.x, slider.y);
      await pointer("mouseMoved", 20, 800);
      await pointer("mouseReleased", 20, 800);
      await wait(80);
      expect(await tuner()).toBe(true);
      await evaluate(`window.__draft=window.__field.value`);
      await click("#effect-tuner-return");
      expect(await opened()).toBe(true);
      expect(await evaluate<string>(`document.activeElement.id`)).toBe(
        "effect-tune",
      );
      expect(
        await evaluate<boolean>(
          `window.__controls===document.querySelector('#background-controls') && window.__field===document.querySelector('#background-ink-opacity') && window.__field.value===window.__draft`,
        ),
      ).toBe(true);
      await click("#effect-tune");
      await click("#background-reset");
      expect(await tuner()).toBe(true);
      await nativeGesture("#effect-tuner", false, true);
      expect(await tuner()).toBe(true);
      await nativeGesture("#effect-tuner", true, false);
      expect(await tuner()).toBe(true);
      await nativeGesture("#effect-tuner", false, false);
      expect(await tuner()).toBe(false);
      await click("#settings-open");
      await click('[data-settings-nav="appearance"]');
      await wait(350);
      expect(await bounds()).toEqual({
        x: 270,
        y: 180,
        width: 740,
        height: 540,
      });
      await evaluate(
        `window.__search=document.querySelector('#theme-search');window.__search.focus();window.__search.value='lightfield';window.__search.setSelectionRange(1,3)`,
      );
      await click('input[name="settingsPresentation"][value="drawer"]');
      expect(
        await evaluate<boolean>(
          `document.activeElement===window.__search && window.__search.selectionStart===1 && window.__search.selectionEnd===3`,
        ),
      ).toBe(true);
      expect(
        await evaluate<number>(
          `document.querySelector('.sheet__panel').getAnimations().length`,
        ),
      ).toBe(1);
      const middle = await bounds();
      expect(middle.width).toBeGreaterThan(440);
      expect(middle.width).toBeLessThan(740);
      expect(
        await evaluate<boolean>(
          `document.querySelector('.sheet__panel').getAnimations().every(a=>a.effect.getKeyframes().every(f=>f.transform==='none'))`,
        ),
      ).toBe(true);
      await wait(230);
      expect(await bounds()).toEqual({ x: 840, y: 0, width: 440, height: 900 });
      await click('input[name="settingsPresentation"][value="modal"]');
      await click('input[name="settingsPresentation"][value="drawer"]');
      await wait(230);
      expect(await bounds()).toEqual({ x: 840, y: 0, width: 440, height: 900 });
      expect(
        await evaluate<number>(
          `document.querySelectorAll('.sheet__panel').length`,
        ),
      ).toBe(1);
      await click('input[name="settingsPresentation"][value="modal"]');
      await click("#settings-close");
      await wait(350);
      expect(await opened()).toBe(false);
      expect(
        await evaluate<number>(
          `document.querySelector('.sheet__panel').getAnimations().length`,
        ),
      ).toBe(0);
      await browser.command("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await click("#settings-open");
      await click('input[name="settingsPresentation"][value="drawer"]');
      expect(await bounds()).toEqual({ x: 840, y: 0, width: 440, height: 900 });
      expect(
        await evaluate<number>(
          `document.querySelector('.sheet__panel').getAnimations().length`,
        ),
      ).toBe(0);
      await outside();
      expect(await opened()).toBe(false);
      console.log(
        "Headless production evidence: modal/drawer exact endpoints, unscaled intermediate bounds, rapid reversal/close/reduced-motion cleanup; inside/outside/slider drag dismissal; unique footer controls and retained DOM identity/focus; lightfield first.",
      );
    } finally {
      cdp?.close();
      process.kill();
      await process.exited;
      await server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  30000,
);
