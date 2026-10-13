import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SEARCH_ENGINES } from "../../../src/ui/shell/search-engines";
import { assertSearchFocus } from "./search-focus-browser";

// Opt-in production smoke owns only its disposable, explicitly headless browser.
const binary = process.env.LIGHTFIELD_UI_HEADLESS_CHROME;
const motionEvidence = process.env.LIGHTFIELD_MOTION_EVIDENCE;
const iconEvidence = process.env.LIGHTFIELD_ICON_EVIDENCE;
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
class CDP {
  onEvent:
    ((method: string, params: Record<string, unknown>) => void) | undefined;
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
        method?: string;
        params?: Record<string, unknown>;
      };
      if (!message.id) {
        if (message.method)
          this.onEvent?.(message.method, message.params ?? {});
        return;
      }
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

test.skipIf(!binary).each(["search focus", "settings"] as const)(
  "headless production %s: keyboard focus, dismissal and presentation geometry",
  async (suite) => {
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
      await browser.command("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-reduced-transparency", value: "no-preference" },
          { name: "prefers-contrast", value: "no-preference" },
        ],
      });
      await browser.command("Page.navigate", {
        url: `http://127.0.0.1:${String(server.port)}/newtab.html`,
      });
      await wait(1000);
      if (suite === "search focus") {
        await assertSearchFocus(browser);
        return;
      }
      await evaluate(
        `for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{if(window.__gestureEvents)window.__gestureEvents.push({type,inside:event.composedPath().includes(window.__gesturePanel)})},true)`,
      );
      await click("#settings-open");
      await wait(350);
      expect(await opened()).toBe(true);
      // Real built-page assets: load every card and every popover item in both themes.
      async function screenshot(name: string) {
        if (!iconEvidence) return;
        await mkdir(iconEvidence, { recursive: true });
        const image = (await browser.command("Page.captureScreenshot", {
          format: "png",
        })) as { data: string };
        await writeFile(
          join(iconEvidence, `${name}.png`),
          Buffer.from(image.data, "base64"),
        );
      }
      async function assertIcons(
        selector: string,
        ids: string[],
        size: number,
        box: number,
      ) {
        const icons = await evaluate<
          {
            src: string;
            loaded: boolean;
            hidden: string;
            alt: string;
            draggable: boolean;
            source: string;
            width: string;
            height: string;
            rendered: number[];
            wrapper: number[];
            parentRendered: number[];
            fit: string;
          }[]
        >(
          `(async()=>{const images=[...document.querySelectorAll(${JSON.stringify(selector)})];await Promise.all(images.map(img=>img.decode()));return images.map(img=>{const r=img.getBoundingClientRect(),p=img.parentElement.getBoundingClientRect();return {src:img.getAttribute('src'),loaded:img.naturalWidth>0,hidden:img.getAttribute('aria-hidden'),alt:img.getAttribute('alt'),draggable:img.draggable,source:img.dataset.source,width:img.getAttribute('width'),height:img.getAttribute('height'),rendered:[r.width,r.height],wrapper:[img.parentElement.offsetWidth,img.parentElement.offsetHeight],parentRendered:[p.width,p.height],fit:getComputedStyle(img).objectFit}})})()`,
        );
        expect(icons).toHaveLength(ids.length);
        for (const [index, icon] of icons.entries()) {
          const id = ids[index];
          if (!id) throw new Error("Unexpected engine image");
          const source = iconSources[id];
          if (!source) throw new Error(`No expected source for ${id}`);
          expect(icon.src.endsWith(`icons/engines/${id}.svg`)).toBe(true);
          expect(icon.loaded).toBe(true);
          expect(icon.hidden).toBe("true");
          expect(icon.alt).toBe("");
          expect(icon.draggable).toBe(false);
          expect(icon.source).toBe(source);
          expect(icon.width).toBe(String(size));
          expect(icon.height).toBe(String(size));
          expect(icon.wrapper).toEqual([box, box]);
          expect(icon.rendered).toEqual(icon.parentRendered);
          for (const edge of icon.rendered)
            expect(edge).toBeLessThanOrEqual(box);
          // Contain preserves the SVG viewBox ratio inside the unchanged optical box.
          expect(icon.fit).toBe("contain");
        }
      }
      const engineIds = SEARCH_ENGINES.map(({ id }) => id);
      const iconSources: Record<string, string> = {
        google: "thesvg-color:google",
        duckduckgo: "thesvg-color:duckduckgo",
        bing: "thesvg-color:bing",
        brave: "thesvg-color:brave-browser",
        ecosia: "thesvg-color:ecosia",
        kagi: "selfhst:kagi",
        startpage: "thesvg-color:startpage",
        qwant: "thesvg-color:qwant",
      };
      for (const theme of ["midnight", "ivory"]) {
        await click('[data-settings-nav="appearance"]');
        await click(`[data-theme-card="${theme}"] .theme-card-select`);
        await click('[data-settings-nav="search"]');
        await wait(350);
        await assertIcons(".engine-card__icon img", engineIds, 24, 24);
        await screenshot(
          `search-engines-${theme === "midnight" ? "dark" : "light"}`,
        );
        await click("#settings-close");
        await wait(350);
        const selected = await evaluate<string>(
          `document.querySelector('select[data-setting="searchEngine"]').value`,
        );
        // The pill and its popover only exist once the capsule search is expanded.
        await click("#island-search-hint");
        await wait(450);
        await assertIcons(".engine-btn__icon img", [selected], 16, 16);
        await screenshot(
          `engine-pill-${theme === "midnight" ? "dark" : "light"}`,
        );
        await click('[aria-label="Select search engine"]');
        await wait(250);
        await assertIcons(".engine-popover-item__icon img", engineIds, 20, 20);
        await screenshot(
          `engine-popover-${theme === "midnight" ? "dark" : "light"}`,
        );
        await click('[aria-label="Select search engine"]');
        await click("#search-collapse-btn");
        await wait(350);
        await click("#settings-open");
        await wait(350);
      }
      await click('[data-settings-nav="appearance"]');
      await click('[data-theme-card="midnight"] .theme-card-select');
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
        x: 240,
        y: 150,
        width: 800,
        height: 600,
      });
      await evaluate(
        `window.__search=document.querySelector('#theme-search');window.__search.focus();window.__search.value='lightfield';window.__search.setSelectionRange(1,3);window.__scroll=document.querySelector('.settings-content');window.__scroll.scrollTop=100;window.__top=window.__scroll.scrollTop`,
      );
      await click('input[name="settingsPresentation"][value="drawer"]');
      expect(
        await evaluate<boolean>(
          `document.activeElement===window.__search && window.__search.selectionStart===1 && window.__search.selectionEnd===3`,
        ),
      ).toBe(true);
      await wait(360);
      expect(
        await evaluate<boolean>(
          `document.querySelector('#theme-search')===window.__search && document.activeElement===window.__search && window.__search.value==='lightfield' && window.__search.selectionStart===1 && window.__search.selectionEnd===3 && window.__scroll.scrollTop===window.__top`,
        ),
      ).toBe(true);
      expect(await bounds()).toEqual({ x: 840, y: 0, width: 440, height: 900 });
      type Sample = {
        t: number;
        opacity: number;
        translate: string;
        transform: string;
        left: number;
        top: number;
        content: number[];
        backdrop: string;
        inline: string;
        origin: string;
        width: number;
        height: number;
        mode: string;
        moving: boolean;
        scrim: string;
        sections: {
          id: string;
          hidden: boolean;
          inert: boolean;
          aria: string;
          width: number;
          height: number;
          display: string;
        }[];
        focus: string;
        selection: number[] | null;
      };
      const trajectories: {
        destination: string;
        samples: Sample[];
        commits: Sample[];
      }[] = [];
      async function beginTrace(duration = 430) {
        await evaluate(`(() => {
          const panel = document.querySelector('.sheet__panel');
          const sheet = document.querySelector('#settings-sheet');
          const generation = window.__traceRevision = (window.__traceRevision ?? 0) + 1;
          window.__traceObserver?.disconnect();
          let start = performance.now();
          document.addEventListener('change',()=>{start=performance.now();window.__samples=[];}, {capture:true,once:true});
          window.__samples = []; window.__commits = [];
          const sample = t => { const r = panel.getBoundingClientRect(); const s = getComputedStyle(panel); return { t: t-start, opacity: Number(s.opacity), translate: s.translate, transform: s.transform, left:r.left,top:r.top,content:[...panel.children].map(e=>Number(getComputedStyle(e).opacity)),backdrop:getComputedStyle(document.querySelector('#settings-scrim')).backdropFilter,inline:panel.style.cssText,origin:s.transformOrigin,width: r.width, height: r.height, mode: sheet.dataset.presentation, moving: panel.hasAttribute('data-presentation-handoff'), scrim: getComputedStyle(document.querySelector('#settings-scrim')).opacity, sections: [...sheet.querySelectorAll('[data-settings-category]')].map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.settingsCategory,hidden:e.hidden,inert:e.inert,aria:e.getAttribute('aria-hidden'),width:r.width,height:r.height,display:getComputedStyle(e).display}}), focus: document.activeElement.id, selection: document.activeElement instanceof HTMLInputElement ? [document.activeElement.selectionStart,document.activeElement.selectionEnd] : null }; };
          const observer = new MutationObserver(() => window.__commits.push(sample(performance.now())));
          window.__traceObserver = observer;
          observer.observe(sheet, { attributes: true, attributeFilter: ['data-presentation'] });
          const frame = t => { if(generation !== window.__traceRevision) return; window.__samples.push(sample(t)); if(t-start<${String(duration)}) requestAnimationFrame(frame); else observer.disconnect(); }; requestAnimationFrame(frame);
        })()`);
      }
      function sectionOwnership(
        samples: Sample[],
        modalCategory = "appearance",
      ) {
        const layouts = new Map<string, { width: number; height: number }>();
        for (const sample of samples.filter((s) => s.opacity > 0)) {
          for (const section of sample.sections) {
            const hidden =
              sample.mode === "modal" && section.id !== modalCategory;
            expect(section.hidden).toBe(hidden);
            expect(section.inert).toBe(hidden);
            expect(section.aria).toBe(String(hidden));
            expect(section.display === "none").toBe(hidden);
            if (!hidden) {
              expect(section.width).toBeGreaterThan(0);
              if (!sample.moving) {
                const key = `${sample.mode}-${section.id}`;
                const previous = layouts.get(key);
                if (previous) {
                  expect(section.width).toBeCloseTo(previous.width, 3);
                  expect(section.height).toBeCloseTo(previous.height, 3);
                } else layouts.set(key, section);
              }
            }
          }
        }
      }
      async function trace(
        destination: "modal" | "drawer",
        native = true,
        modalCategory = "appearance",
      ) {
        await beginTrace();
        if (native) {
          const point = await evaluate<{ x: number; y: number }>(
            `(() => { const e=document.querySelector('input[name="settingsPresentation"][value="${destination}"]').nextElementSibling; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
          );
          await pointer("mousePressed", point.x, point.y);
          await pointer("mouseReleased", point.x, point.y);
        } else
          await evaluate(
            `(()=>{const input=document.querySelector('input[name="settingsPresentation"][value="${destination}"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
          );
        await wait(460);
        const samples = await evaluate<Sample[]>("window.__samples");
        const commits = await evaluate<Sample[]>("window.__commits");
        expect(
          samples.filter((s) => s.opacity > 0 && s.opacity < 1).length,
        ).toBeGreaterThan(2);
        sectionOwnership(samples, modalCategory);
        if (!native && modalCategory === "fonts") {
          for (const sample of samples) {
            expect(sample.focus).toBe("custom-display-font");
            expect(sample.selection).toEqual([2, 7]);
          }
        }
        expect(commits).toHaveLength(1);
        expect(commits[0]?.opacity).toBe(0);
        const endpoint =
          destination === "modal"
            ? { left: 240, top: 150, width: 800, height: 600 }
            : { left: 840, top: 0, width: 440, height: 900 };
        const arrival = samples.filter((s) => s.mode === destination);
        // A 2D matrix(a, b, c, d, e, f) carries its scale on the a and d axes.
        const scaleAxes = (s: Sample) => {
          const parts = s.transform.slice(7, -1).split(",").map(Number);
          return [parts[0] ?? 1, parts[3] ?? 1];
        };
        // Text must never be shown off-scale: every sample with visible content
        // has to be within 5% of the rest scale (measured worst case is ~0.6%).
        const offScale = arrival.filter((s) => {
          if (!s.content.some((o) => o > 0)) return false;
          const axes = scaleAxes(s);
          return axes.some((scale) => Math.abs(scale - 1) >= 0.05);
        });
        expect(
          offScale.map((s) => ({
            t: Math.round(s.t),
            transform: s.transform,
            content: s.content,
          })),
        ).toEqual([]);

        for (const s of samples) {
          expect(s.scrim).toBe("1");
          expect(s.backdrop).toBe("blur(6px)");
          expect(s.inline).not.toMatch(
            /(?:^|;)\s*(?:width|height|top|left|inset|translate):/,
          );
        }
        for (const key of ["left", "top", "width", "height"] as const) {
          let previous = Infinity;
          for (const s of arrival) {
            const distance = Math.abs(s[key] - endpoint[key]);
            expect(distance).toBeLessThanOrEqual(previous + 0.1);
            previous = distance;
          }
          expect(samples.at(-1)?.[key]).toBeCloseTo(endpoint[key], 3);
        }
        // Authored timings (90ms out, 160ms morph, 96ms content delay, 120ms fade) are
        // pinned deterministically by the coordinator unit tests. Sampled wall-clock here
        // only guards a gross stall, so a loaded machine cannot fail an exact recipe.
        expect(
          arrival.some(
            (s) =>
              s.t < 750 &&
              Math.abs(s.width - endpoint.width) < 0.01 &&
              Math.abs(s.height - endpoint.height) < 0.01,
          ),
        ).toBe(true);
        // The trajectory window is timing evidence; the settled endpoint is asserted
        // from the DOM once the handoff finishes, so slow frames cannot fail the run.
        // Content must be hidden exactly at the layout commit, which is what keeps text
        // from being shown stretched; the MutationObserver sample is not frame-sampled.
        expect(commits[0]?.content).toEqual([0, 0, 0]);
        await rest(destination);
        trajectories.push({ destination, samples, commits });
      }
      await trace("modal");
      await trace("drawer");
      // True custom Fonts editor: programmatic radio event must not move focus or deactivate its owner.
      await click("#font-tab-custom");
      await evaluate(
        `window.__font=document.querySelector('#custom-display-font');window.__font.value='Owned font draft';window.__font.dispatchEvent(new Event('input',{bubbles:true}));window.__font.focus({preventScroll:true});window.__font.setSelectionRange(2,7)`,
      );
      await trace("modal", false, "fonts");
      expect(
        await evaluate<boolean>(
          `document.activeElement===window.__font && document.querySelector('#custom-display-font')===window.__font && window.__font.value==='Owned font draft' && window.__font.selectionStart===2 && window.__font.selectionEnd===7 && document.querySelector('#tab-btn-fonts').getAttribute('aria-selected')==='true'`,
        ),
      ).toBe(true);
      await trace("drawer", false, "fonts");
      // Synthetic zero-opacity condition: pause the owned arrival animation, not native pointer coverage.
      await evaluate(
        `document.querySelector('#settings-close').focus({preventScroll:true});document.querySelector('input[name="settingsPresentation"][value="modal"]').click();window.__pausedZero=new Promise(resolve=>{function frame(){const p=document.querySelector('.sheet__panel');if(document.querySelector('#settings-sheet').dataset.presentation==='modal'&&p.hasAttribute('data-presentation-handoff')){const a=p.getAnimations()[0];if(a){a.pause();a.currentTime=0;resolve(true);return;}}requestAnimationFrame(frame);}requestAnimationFrame(frame);})`,
      );
      await evaluate("window.__pausedZero");
      const svgGuard = await evaluate<{
        opacity: string;
        canceled: boolean;
        sameCategory: boolean;
      }>(
        `(()=>{const before=document.querySelector('[data-settings-nav][aria-selected="true"]').dataset.settingsNav;const path=document.querySelector('[data-settings-nav="background"] svg path');const event=new MouseEvent('click',{bubbles:true,cancelable:true});const canceled=!path.dispatchEvent(event);return {opacity:getComputedStyle(document.querySelector('.sheet__panel')).opacity,canceled,sameCategory:document.querySelector('[data-settings-nav][aria-selected="true"]').dataset.settingsNav===before};})()`,
      );
      expect(svgGuard).toEqual({
        opacity: "0",
        canceled: true,
        sameCategory: true,
      });
      const positiveGuard = await evaluate<{
        opacity: number;
        canceled: boolean;
        sameCategory: boolean;
      }>(
        `(()=>{const p=document.querySelector('.sheet__panel');for(const a of p.getAnimations()){a.pause();a.currentTime=60;}for(const e of p.children)for(const a of e.getAnimations()){a.pause();a.currentTime=0;}const before=document.querySelector('[data-settings-nav][aria-selected="true"]').dataset.settingsNav;const event=new MouseEvent('click',{bubbles:true,cancelable:true});const canceled=!document.querySelector('[data-settings-nav="background"] svg path').dispatchEvent(event);return {opacity:Number(getComputedStyle(p).opacity),canceled,sameCategory:document.querySelector('[data-settings-nav][aria-selected="true"]').dataset.settingsNav===before}})()`,
      );
      expect(positiveGuard.opacity).toBeGreaterThan(0);
      expect(positiveGuard.canceled).toBe(true);
      expect(positiveGuard.sameCategory).toBe(true);
      await evaluate(
        `document.querySelector('#settings-close svg line').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`,
      );
      expect(await opened()).toBe(false);
      await click("#settings-open");
      await wait(450);
      await click('[data-settings-nav="appearance"]');
      await click('input[name="settingsPresentation"][value="drawer"]');
      await wait(360);
      async function rest(mode: "modal" | "drawer") {
        await wait(450);

        expect(
          await evaluate<boolean>(
            `(() => { const p=document.querySelector('.sheet__panel'); return document.querySelector('#settings-sheet').dataset.presentation==='${mode}' && getComputedStyle(p).opacity==='1' && !p.hasAttribute('data-presentation-handoff') && !p.style.opacity && !p.style.transform && !p.style.transformOrigin && !p.hasAttribute('data-presentation-morph') && [...p.children].every(e=>!e.style.opacity && e.getAnimations().length===0 && Number(getComputedStyle(e).opacity)===1) && p.getAnimations().length===0; })()`,
          ),
        ).toBe(true);
      }
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="modal"]').click()`,
      );
      await wait(20);
      await evaluate(
        `document.querySelector('#settings-close').focus({preventScroll:true})`,
      );
      await rest("modal");
      expect(await evaluate<string>("document.activeElement.id")).toBe(
        "settings-close",
      );
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="drawer"]').click()`,
      );
      await rest("drawer");
      // Native radio arrows animate too, without requiring input focus loss.
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="drawer"]').focus()`,
      );
      for (const type of ["keyDown", "keyUp"])
        await browser.command("Input.dispatchKeyEvent", {
          type,
          key: "ArrowLeft",
          code: "ArrowLeft",
        });
      await rest("modal");
      expect(
        await evaluate<boolean>(
          `document.activeElement===document.querySelector('input[name="settingsPresentation"][value="modal"]') && document.activeElement.checked`,
        ),
      ).toBe(true);
      for (const delay of [20, 170]) {
        await beginTrace(700);
        await evaluate(
          `document.querySelector('input[name="settingsPresentation"][value="drawer"]').click()`,
        );
        await wait(delay);
        const retarget = await evaluate<{
          before: number[];
          after: number[];
          t: number;
        }>(
          `(async()=>{const p=document.querySelector('.sheet__panel');const rect=()=>{const r=p.getBoundingClientRect();return [r.left,r.top,r.width,r.height]};const before=rect();const input=document.querySelector('input[name="settingsPresentation"][value="modal"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();return {before,after:rect(),t:window.__samples.at(-1).t};})()`,
        );
        // Computed matrices serialize with six-digit precision; allow <0.01 CSS px.
        for (let i = 0; i < 4; i++)
          expect(
            Math.abs((retarget.after[i] ?? 0) - (retarget.before[i] ?? 0)),
          ).toBeLessThan(0.01);
        await rest("modal");
        await wait(120);
        const samples = await evaluate<Sample[]>("window.__samples");
        const commits = await evaluate<Sample[]>("window.__commits");
        sectionOwnership(samples);
        expect(commits).toHaveLength(delay === 20 ? 1 : 2);
        expect(commits.every((s) => s.opacity === 0)).toBe(true);
        const arrival = samples.filter(
          (s) => s.t > retarget.t && s.mode === "modal",
        );
        for (const key of ["left", "top", "width", "height"] as const) {
          let distance = Infinity;
          const target = { left: 240, top: 150, width: 800, height: 600 }[key];
          for (const s of arrival) {
            expect(Math.abs(s[key] - target)).toBeLessThanOrEqual(
              distance + 0.1,
            );
            distance = Math.abs(s[key] - target);
          }
        }
        expect(
          arrival.some(
            (s) =>
              s.t - retarget.t < 750 &&
              Math.abs(s.width - 800) < 0.01 &&
              Math.abs(s.height - 600) < 0.01,
          ),
        ).toBe(true);
        // The reverse commit hides content too, and rest("modal") above proves the
        // settled endpoint; neither depends on how densely frames were sampled.
        expect(commits.every((s) => s.content.every((o) => o === 0))).toBe(
          true,
        );
        trajectories.push({
          destination: `reversal-${String(delay)}ms-modal`,
          samples,
          commits,
        });
      }
      // Reversing while the content is mid-fade must fade the rendered text out with
      // the surface instead of collapsing it to the morph rule's zero.
      await beginTrace(700);
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="drawer"]').click()`,
      );
      await wait(250);
      expect(
        await evaluate<boolean>(
          `document.querySelector('.sheet__panel').hasAttribute('data-presentation-morph')`,
        ),
      ).toBe(true);
      await evaluate(
        `(()=>{const input=document.querySelector('input[name="settingsPresentation"][value="modal"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await wait(40);
      const departing = await evaluate<{ content: number[]; opacity: number }>(
        `(()=>{const p=document.querySelector('.sheet__panel');return {content:[...p.children].map(e=>Number(getComputedStyle(e).opacity)),opacity:Number(getComputedStyle(p).opacity)};})()`,
      );
      expect(departing.opacity).toBeGreaterThan(0);
      expect(Math.min(...departing.content)).toBeGreaterThan(0.05);
      await rest("modal");
      const midSamples = await evaluate<Sample[]>("window.__samples");
      const midCommits = await evaluate<Sample[]>("window.__commits");
      sectionOwnership(midSamples);
      expect(midCommits.every((s) => s.opacity === 0)).toBe(true);
      let departure: { t: number; visible: number } | undefined;
      for (const s of midSamples) {
        const visible = s.opacity * Math.min(...s.content);
        if (departure && s.t - departure.t < 40)
          expect(visible).toBeGreaterThanOrEqual(departure.visible - 0.34);
        departure = { t: s.t, visible };
      }
      trajectories.push({
        destination: "reversal-mid-content-modal",
        samples: midSamples,
        commits: midCommits,
      });
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="drawer"]').click()`,
      );
      await wait(100);
      await click("#settings-close");
      expect(await opened()).toBe(false);
      await click("#settings-open");
      await wait(450);
      await rest("drawer");
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="modal"]').click()`,
      );
      await wait(20);
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 901,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await rest("modal");
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="drawer"]').click()`,
      );
      await wait(20);
      await click('[data-settings-nav="fonts"]');
      await rest("drawer");
      await click('[data-settings-nav="appearance"]');
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="modal"]').click()`,
      );
      await wait(20);
      await browser.command("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await rest("modal");
      await browser.command("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
      // A rejected close must settle visibly so the dirty guard remains usable.
      await click("#theme-tab-custom");
      await evaluate(
        `document.querySelector('input[name="settingsPresentation"][value="drawer"]').click(); document.querySelector('#custom-create').click()`,
      );
      await wait(20);
      await evaluate(
        `const name=document.querySelector('#custom-name');name.value='Handoff guard';name.dispatchEvent(new Event('input',{bubbles:true}))`,
      );
      await wait(5);
      // Synthetic paused outgoing zero: the Close SVG must still reach the real dirty guard.
      const zeroCloseOpacity = await evaluate<string>(
        `(()=>{const p=document.querySelector('.sheet__panel'),a=p.getAnimations()[0];a.pause();a.currentTime=Number(a.effect.getTiming().duration);const opacity=getComputedStyle(p).opacity;document.querySelector('#settings-close svg line').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return opacity;})()`,
      );
      expect(zeroCloseOpacity).toBe("0");
      expect(await opened()).toBe(true);
      await rest("drawer");
      expect(
        await evaluate<boolean>(
          `!!document.querySelector('#custom-keep-editing')`,
        ),
      ).toBe(true);
      await click("#custom-keep-editing");
      await click("#custom-cancel");
      await click("#custom-discard");
      const evidence = motionEvidence;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await writeFile(
          join(evidence, "trajectory.json"),
          JSON.stringify(
            {
              viewport: [1280, 900],
              dpr: 1,
              visibility: await evaluate("document.visibilityState"),
              trajectories,
              syntheticGuards: {
                svgGuard,
                positiveGuard,
                zeroCloseOpacity,
                dirtyCloseBlocked: true,
              },
            },
            null,
            2,
          ),
        );
        // Recording is deliberately separate from the non-recorded timing assertions.
        await click('input[name="settingsPresentation"][value="modal"]');
        await wait(250);
        const images: { t: number; data: string }[] = [];
        let firstTimestamp: number | undefined;
        browser.onEvent = (method, params) => {
          if (method !== "Page.screencastFrame") return;
          const timestamp = (params.metadata as { timestamp: number })
            .timestamp;
          firstTimestamp ??= timestamp;
          images.push({
            t: (timestamp - firstTimestamp) * 1000,
            data: params.data as string,
          });
          void browser.command("Page.screencastFrameAck", {
            sessionId: params.sessionId,
          });
        };
        await browser.command("Page.startScreencast", {
          format: "png",
          everyNthFrame: 1,
        });
        await wait(100);
        await evaluate(
          `document.querySelector('input[name="settingsPresentation"][value="drawer"]').click()`,
        );
        await wait(450);
        await evaluate(
          `document.querySelector('input[name="settingsPresentation"][value="modal"]').click()`,
        );
        await wait(450);
        await browser.command("Page.stopScreencast");
        browser.onEvent = undefined;
        expect(images.length).toBeGreaterThan(3);
        await writeFile(join(evidence, "frames.json"), JSON.stringify(images));
        await writeFile(
          join(evidence, "filmstrip.html"),
          `<!doctype html><title>Settings handoff: separately recorded frames</title><button onclick="play()">Play</button><span id="time"></span><img id="frame" style="width:100%"><script>const frames=${JSON.stringify(images)}; function show(i){frame.src='data:image/png;base64,'+frames[i].data; time.textContent=frames[i].t.toFixed(1)+' ms';} function play(){frames.forEach((f,i)=>setTimeout(()=>show(i),f.t));} show(0);</script>`,
        );
      }
      await click('input[name="settingsPresentation"][value="modal"]');
      await click('input[name="settingsPresentation"][value="drawer"]');
      await wait(360);
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
      const layouts = [1440, 620, 320, 360, 390, 430].flatMap((width) =>
        ["inherit", "ui-monospace, monospace"].map((font) => ({ width, font })),
      );
      for (const { width, font } of layouts) {
        await evaluate(
          `document.querySelector('.sheet__panel').style.setProperty('--font-body', ${JSON.stringify(font)})`,
        );
        await browser.command("Emulation.setDeviceMetricsOverride", {
          width,
          height: width === 1440 ? 900 : 568,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
        await browser.command("Emulation.setTouchEmulationEnabled", {
          enabled: width < 600,
        });
        expect(
          await evaluate<boolean>("matchMedia('(pointer: coarse)').matches"),
        ).toBe(width < 600);
        await click("#settings-open");
        await click('[data-settings-nav="appearance"]');
        await click('input[name="settingsPresentation"][value="modal"]');
        async function presentationGeometry(presentation: "modal" | "drawer") {
          const geometry = await evaluate<{
            presentation: string;
            checked: string[];
            sameInlinePattern: boolean;
            wrapsOnlyWhenNeeded: boolean;
            headingGap: number;
            noOverflow: boolean;
            selectedStyle: boolean;
            otherControlsUnchanged: boolean;
          }>(`(() => {
            const row = document.querySelector('.presentation-row');
            const bar = row.querySelector('.segmented');
            const labels = [...bar.querySelectorAll('.segmented-item')];
            const buttons = labels.map(e => e.querySelector('.segmented-btn'));
            const rects = buttons.map(e => e.getBoundingClientRect());
            const style = getComputedStyle(bar);
            const label = row.querySelector('.control__label');
            const labelRect = label.getBoundingClientRect();
            const barRect = bar.getBoundingClientRect();
            const islandBar = document.querySelector('input[name="islandMode"]').closest('.segmented');
            const islandButton = islandBar.querySelector('.segmented-btn');
            const required = labelRect.width + barRect.width + parseFloat(getComputedStyle(row).columnGap);
            const inline = Math.abs(labelRect.top + labelRect.height / 2 - barRect.top - barRect.height / 2) < 1;
            const heading = document.querySelector('.control--stacked .control__row');
            const filter = document.querySelector('.control--stacked .filter-row');
            const inputs = [...bar.querySelectorAll('input')];
            const selected = inputs.find(e => e.checked).nextElementSibling;
            const unselected = inputs.find(e => !e.checked).nextElementSibling;
            const content = document.querySelector('.settings-content');
            return {
              presentation: document.querySelector('#settings-sheet').dataset.presentation,
              checked: inputs.filter(e => e.checked).map(e => e.value),
              sameInlinePattern: rects.every(r => r.height === islandButton.getBoundingClientRect().height)
                && bar.offsetHeight === islandBar.offsetHeight
                && Math.abs(rects[0].top - rects[1].top) < 1
                && style.padding === getComputedStyle(islandBar).padding,
              wrapsOnlyWhenNeeded: required <= row.clientWidth + 0.1 ? inline : barRect.top - labelRect.bottom >= 12,
              headingGap: filter.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
              noOverflow: buttons.every(e => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1)
                && rects.every(r => r.left >= content.getBoundingClientRect().left && r.right <= content.getBoundingClientRect().right)
                && content.scrollWidth <= content.clientWidth + 1
                && document.documentElement.scrollWidth <= innerWidth,
              selectedStyle: getComputedStyle(selected).backgroundColor !== getComputedStyle(unselected).backgroundColor,
              otherControlsUnchanged: !matchMedia("(pointer: coarse)").matches || [...document.querySelectorAll('#panel-themes .segmented-btn')]
                .filter(e => !bar.contains(e)).every(e => e.getBoundingClientRect().height >= 44),
            };
          })()`);
          expect(geometry).toEqual({
            presentation,
            checked: [presentation],
            sameInlinePattern: true,
            wrapsOnlyWhenNeeded: true,
            headingGap: 8,
            noOverflow: true,
            selectedStyle: true,
            otherControlsUnchanged: true,
          });
        }
        await presentationGeometry("modal");
        // Click the visible label, exercising the native radio change handler.
        const target = await evaluate<{ x: number; y: number }>(`(() => {
          const button = document.querySelector('input[name="settingsPresentation"][value="drawer"]').nextElementSibling;
          button.scrollIntoView({block: 'center'});
          const r = button.getBoundingClientRect();
          return {x: r.x + r.width / 2, y: r.y + r.height / 2};
        })()`);
        await pointer("mousePressed", target.x, target.y);
        await pointer("mouseReleased", target.x, target.y);
        await wait(60);
        await presentationGeometry("drawer");
        expect(
          await evaluate<boolean>(
            'document.activeElement === document.querySelector(\'input[name="settingsPresentation"][value="drawer"]\')',
          ),
        ).toBe(true);
        for (const type of ["keyDown", "keyUp"]) {
          await browser.command("Input.dispatchKeyEvent", {
            type,
            key: "ArrowLeft",
            code: "ArrowLeft",
          });
        }
        await wait(60);
        await presentationGeometry("modal");
        expect(
          await evaluate<boolean>(`(() => {
            const input = document.querySelector('input[name="settingsPresentation"][value="modal"]');
            const style = getComputedStyle(input.nextElementSibling);
            return document.activeElement === input && input.matches(':focus-visible')
              && style.outlineStyle === 'solid' && style.outlineWidth === '2px';
          })()`),
        ).toBe(true);
        await click('input[name="settingsPresentation"][value="drawer"]');
        // The drawer mounts every category together: audit heading rhythm without
        // assigning margins to inline labels or changing existing font-tab sizing.
        expect(
          await evaluate<boolean>(`(() => {
          const headers = [...document.querySelectorAll('.modal__panel > .panel__header')];
          return headers.every(header => header.nextElementSibling.getBoundingClientRect().top
            - header.getBoundingClientRect().bottom >= 10);
        })()`),
        ).toBe(true);
        await click("#theme-tab-custom");
        await click("#custom-create");
        expect(
          await evaluate<
            number[]
          >(`[...document.querySelectorAll('.custom-color-field')].map(field =>
          field.querySelector('.custom-color-picker-wrap').getBoundingClientRect().top
            - field.querySelector('.custom-color-label').getBoundingClientRect().bottom)`),
        ).toEqual([8, 8, 8]);
        await click("#custom-cancel");

        await click("#settings-close");
        console.log(
          `Production position segments ${String(width)}px (${font}): Island-mode inline geometry, intrinsic wrapping, 8px Colorway gap, no overflow, native label/keyboard switching and focus ring passed`,
        );
      }
      console.log(
        "Headless production evidence: modal/drawer exact endpoints, rapid reversal/close/reduced-motion behavior; inside/outside/slider drag dismissal; unique footer controls and retained DOM identity/focus; lightfield first.",
      );
    } finally {
      cdp?.close();
      process.kill();
      await process.exited;
      await server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  40000,
);
