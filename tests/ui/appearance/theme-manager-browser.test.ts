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
  "headless main theme manager: real storage workflows and compact geometry",
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
    const browserProcess = Bun.spawn(
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
      const shellGeometry = async () => {
        const state = await evaluate<{ top: number; headerInside: boolean }>(
          `(()=>{const p=document.querySelector('.sheet__panel'),h=p.querySelector('.sheet__head'),r=p.getBoundingClientRect(),s=h.getBoundingClientRect();return {top:p.scrollTop,headerInside:s.top>=r.top-1&&s.bottom<=r.bottom+1}})()`,
        );
        expect(state.top).toBe(0);
        expect(state.headerInside).toBe(true);
      };
      // Scroll only the designated content scroller, never hidden shell ancestors.
      const reveal = async (selector: string) => {
        await evaluate(
          `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=e.closest('.settings-content');if(!s)return;const r=e.getBoundingClientRect(),v=s.getBoundingClientRect();if(r.top<v.top)s.scrollTop+=r.top-v.top-8;else if(r.bottom>v.bottom)s.scrollTop+=r.bottom-v.bottom+8})()`,
        );
        await wait(30);
      };
      const click = async (selector: string) => {
        await reveal(selector);
        const pos = await evaluate<{ x: number; y: number }>(
          `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
        );
        await pointer("mousePressed", pos.x, pos.y);
        await pointer("mouseReleased", pos.x, pos.y);
        await wait(80);
        if (await opened()) await shellGeometry();
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
      const opened = () =>
        evaluate<boolean>(
          `document.querySelector('#settings-sheet').classList.contains('is-open')`,
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
      const set = async (selector: string, value: string) => {
        await evaluate(
          `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
        );
        await wait(40);
      };
      const theme = () =>
        evaluate<string>(`document.documentElement.dataset.theme`);
      const count = () =>
        evaluate<number>(
          `document.querySelectorAll('[data-custom-theme]').length`,
        );
      const draft = () =>
        evaluate<Record<string, string>>(
          `Object.fromEntries(['name','paper','ink','accent'].map(k=>[k,document.querySelector('#custom-'+k+(k==='name'?'':'-hex')).value]))`,
        );
      const save = async () => {
        await click("#custom-save");
        await wait(300);
      };
      const more = async (id: string, action: string) => {
        await click(`[data-theme-card="${id}"] .theme-more`);
        const index =
          ["Rename", "Duplicate", "Export", "Delete"].indexOf(action) + 1;
        await click(`[role="menuitem"]:nth-child(${String(index)})`);
        await wait(100);
      };
      await click("#settings-open");
      await wait(350);
      await evaluate(`document.querySelector('#tab-btn-themes').focus()`);
      for (const type of ["keyDown", "keyUp"])
        await browser.command("Input.dispatchKeyEvent", {
          type,
          key: "ArrowDown",
          code: "ArrowDown",
        });
      await wait(60);
      expect(await evaluate<string>(`document.activeElement.id`)).toBe(
        "tab-btn-backgrounds",
      );
      for (const type of ["keyDown", "keyUp"])
        await browser.command("Input.dispatchKeyEvent", {
          type,
          key: "ArrowUp",
          code: "ArrowUp",
        });
      await wait(60);
      expect(await evaluate<string>(`document.activeElement.id`)).toBe(
        "tab-btn-themes",
      );
      expect(
        await evaluate<number>(
          `document.querySelectorAll('[data-theme-card]').length`,
        ),
      ).toBe(36);
      expect(
        await evaluate<boolean>(
          `[...document.querySelectorAll('.theme-card__tone-badge')].every(e=>['Light','Dark'].includes(e.textContent))`,
        ),
      ).toBe(true);
      expect(
        await evaluate<boolean>(
          `[...document.querySelectorAll('.theme-library-card')].every(c=>!c.textContent.includes('Active') && c.querySelectorAll('button').length===2 && !c.textContent.includes('Apply'))`,
        ),
      ).toBe(true);
      const expectedIvory = await evaluate<Record<string, string>>(
        `(()=>{const p=document.createElement('div');p.dataset.theme='ivory';p.hidden=true;document.body.append(p);const style=getComputedStyle(p),c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');const value=Object.fromEntries(['paper','ink','accent'].map(k=>{x.fillStyle=style.getPropertyValue('--color-'+k);x.fillRect(0,0,1,1);return [k,'#'+[...x.getImageData(0,0,1,1).data].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('')]}));p.remove();return value})()`,
      );
      const source = await theme();
      const sourceTokens = await evaluate<string>(
        `document.documentElement.style.cssText`,
      );
      await click('[data-theme-card="ivory"] .pick-card__edit');
      expect(await theme()).toBe(source);
      const ivory = await draft();
      expect(ivory.name).toBe("Ivory copy");
      expect(ivory).toEqual({ name: "Ivory copy", ...expectedIvory });
      expect(ivory.paper).not.toBe("#11111b");
      await set("#custom-name", "Ivory authored copy");
      expect(
        await evaluate<string>(`document.documentElement.style.cssText`),
      ).toBe(sourceTokens);
      await save();
      expect(await theme()).toBe(source);
      expect(await count()).toBe(1);
      const copyId = await evaluate<string>(
        `document.querySelector('[data-custom-theme]').dataset.customTheme`,
      );
      await click(`[data-theme-card="${copyId}"] .pick-card__edit`);
      expect(await draft()).toEqual({ ...ivory, name: "Ivory authored copy" });
      await click("#custom-cancel");
      expect(
        await evaluate<string>(
          `document.activeElement.getAttribute('aria-label')`,
        ),
      ).toBe("Edit Ivory authored copy");
      await more(copyId, "Duplicate");
      await click("#custom-cancel");
      expect(await count()).toBe(1);
      expect(
        await evaluate<string>(
          `document.activeElement.getAttribute('aria-label')`,
        ),
      ).toBe("More actions for Ivory authored copy");
      await more(copyId, "Rename");
      await click("#custom-cancel");
      expect(
        await evaluate<string>(
          `document.activeElement.getAttribute('aria-label')`,
        ),
      ).toBe("More actions for Ivory authored copy");
      await more(copyId, "Rename");
      await set("#custom-name", "A long custom theme name of forty chars");
      await save();
      expect(await theme()).toBe(source);
      await click("#custom-create");
      await set("#custom-name", "Red");
      await set("#custom-paper-hex", "#101010");
      await set("#custom-ink-hex", "#eeeeee");
      await set("#custom-accent-hex", "#ff0000");
      expect(await theme()).toBe(source);
      await save();
      const red = await evaluate<string>(
        `[...document.querySelectorAll('[data-custom-theme]')].find(e=>e.querySelector('.pick-card__name').textContent==='Red').dataset.customTheme`,
      );
      const select = async (id: string, keyboard = false) => {
        await reveal(`[data-theme-card="${id}"] .theme-card-select`);
        await wait(50);
        if (keyboard) {
          await evaluate(
            `document.querySelector('[data-theme-card="${id}"] .theme-card-select').focus()`,
          );
          for (const type of ["keyDown", "keyUp"])
            await browser.command("Input.dispatchKeyEvent", {
              type,
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
              text: type === "keyDown" ? "\r" : "",
              unmodifiedText: type === "keyDown" ? "\r" : "",
            });
        } else {
          const pos = await evaluate<{ x: number; y: number }>(
            `(()=>{const r=document.querySelector('[data-theme-card="${id}"] .theme-card-select').getBoundingClientRect();return {x:r.x+20,y:r.y+40}})()`,
          );
          await pointer("mousePressed", pos.x, pos.y);
          await pointer("mouseReleased", pos.x, pos.y);
        }
        await wait(300);
        expect(await theme()).toBe(id);
      };
      const boundary = () =>
        evaluate<{ actual: string; expected: string }>(
          `(()=>{const c=document.querySelector('.theme-library-card.is-selected'),p=document.createElement('span');p.style.border='1px solid var(--ui-accent-boundary, var(--color-accent-boundary))';c.append(p);const v={actual:getComputedStyle(c).borderTopColor,expected:getComputedStyle(p).borderTopColor};p.remove();return v})()`,
        );
      await select(red);
      const redBoundary = await boundary();
      expect(redBoundary.actual).toBe(redBoundary.expected);
      await click(`[data-theme-card="${red}"] .pick-card__edit`);
      await set("#custom-accent-hex", "#00ff00");
      expect(
        (await boundary().catch(() => ({ actual: "", expected: "" }))).actual,
      ).toBe("");
      expect(
        await evaluate<string>(
          `getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()`,
        ),
      ).toBe("#ff0000");
      await save();
      const greenBoundary = await boundary();
      expect(greenBoundary.actual).toBe(greenBoundary.expected);
      expect(greenBoundary.actual).not.toBe(redBoundary.actual);
      expect(
        await evaluate<string>(
          `getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()`,
        ),
      ).toBe("#00ff00");
      await select(copyId, true);
      await more(red, "Delete");
      expect(await count()).toBe(1);
      await click("#custom-theme-undo");
      expect(await count()).toBe(2);
      expect(await theme()).toBe(copyId);
      await more(copyId, "Delete");
      expect(await count()).toBe(2);
      expect(
        await evaluate<string>(
          `document.querySelector('.theme-exit-guard').textContent`,
        ),
      ).toContain("Midnight");
      await click(".theme-exit-guard .btn");
      expect(await theme()).toBe("midnight");
      await click("#custom-theme-undo");
      expect(await theme()).toBe(copyId);
      // Menus consume Escape without closing Settings or activating a card.
      await click(`[data-theme-card="${red}"] .theme-more`);
      for (const type of ["keyDown", "keyUp"])
        await browser.command("Input.dispatchKeyEvent", {
          type,
          key: "Escape",
          code: "Escape",
        });
      expect(
        await evaluate<boolean>(
          `document.querySelector('[role="menu"]')===null && document.querySelector('#settings-sheet').classList.contains('is-open')`,
        ),
      ).toBe(true);
      expect(await theme()).toBe(copyId);
      // Real export schema captured from the download Blob, then real file input import.
      await evaluate(
        `window.__exports=[];window.__createURL=URL.createObjectURL;URL.createObjectURL=function(blob){window.__exports.push(blob.text());return window.__createURL.call(this,blob)}`,
      );
      await more(red, "Export");
      const single = await evaluate<string>(`window.__exports.at(-1)`);
      expect((JSON.parse(single) as { themes: unknown[] }).themes.length).toBe(
        1,
      );
      await click("#custom-export");
      const all = await evaluate<string>(`window.__exports.at(-1)`);
      expect((JSON.parse(all) as { schema: string }).schema).toBe(
        "lightfield.custom-themes",
      );
      expect((JSON.parse(all) as { themes: unknown[] }).themes.length).toBe(2);
      await evaluate(
        `(()=>{const input=document.querySelector('#custom-import-file'),dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(all)}],'owned-export.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`,
      );
      await wait(200);
      expect(await count()).toBe(4);
      expect(await theme()).toBe(copyId);
      // Draft guard covers Cancel, category switch, outside dismissal and close.
      await click(`[data-theme-card="${red}"] .pick-card__edit`);
      await set("#custom-name", "Dirty");
      await click("#custom-cancel");
      expect(
        await evaluate<boolean>(
          `!!document.querySelector('#custom-keep-editing')`,
        ),
      ).toBe(true);
      await click("#custom-keep-editing");
      await click('[data-settings-nav="fonts"]');
      expect(
        await evaluate<boolean>(
          `document.querySelector('#tab-btn-themes').getAttribute('aria-selected')==='true'`,
        ),
      ).toBe(true);
      await click("#custom-keep-editing");
      await outside();
      expect(
        await evaluate<boolean>(
          `!!document.querySelector('#custom-keep-editing')`,
        ),
      ).toBe(true);
      await click("#custom-keep-editing");
      await click("#settings-close");
      await click("#custom-discard");
      expect(await opened()).toBe(false);
      await click("#settings-open");
      await wait(350);
      await click(`[data-theme-card="${red}"] .pick-card__edit`);
      await set("#custom-name", "Conflict preserved");
      await evaluate(
        `(()=>{const k='lightfield:custom-themes',oldValue=localStorage.getItem(k),items=JSON.parse(oldValue);items[0].name='External rename';const newValue=JSON.stringify(items);localStorage.setItem(k,newValue);window.dispatchEvent(new StorageEvent('storage',{key:k,oldValue,newValue,storageArea:localStorage}))})()`,
      );
      await wait(100);
      expect((await draft()).name).toBe("Conflict preserved");
      expect(
        await evaluate<string>(
          `document.querySelector('#custom-theme-status').textContent`,
        ),
      ).toContain("draft is preserved");
      for (const type of ["keyDown", "keyUp"])
        await browser.command("Input.dispatchKeyEvent", {
          type,
          key: "Escape",
          code: "Escape",
        });
      expect(
        await evaluate<boolean>(
          `!!document.querySelector('#custom-keep-editing')`,
        ),
      ).toBe(true);
      await click("#custom-keep-editing");
      expect(await evaluate<string>(`document.activeElement.id`)).toBe(
        "custom-name",
      );
      await click('[data-settings-nav="fonts"]');
      await click("#custom-exit-save");
      await wait(300);
      expect(
        await evaluate<string>(
          `document.querySelector('[data-settings-nav="fonts"]').getAttribute('aria-selected')`,
        ),
      ).toBe("true");
      await click('[data-settings-nav="appearance"]');
      // Failure injection is a UI fixture only; successful paths above use unmodified browser storage.
      await evaluate(
        `window.__storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='lightfield:custom-themes'&&window.__failTheme)throw new Error('Owned failed write');return window.__storageSet.call(this,k,v)};window.__failTheme=true`,
      );
      await click(`[data-theme-card="${red}"] .pick-card__edit`);
      await set("#custom-name", "Failed draft");
      await save();
      expect((await draft()).name).toBe("Failed draft");
      expect(
        await evaluate<string>(
          `document.querySelector('#custom-theme-status').textContent`,
        ),
      ).toContain("Owned failed write");
      await evaluate(`window.__failTheme=false`);
      await click("#custom-cancel");
      await click("#custom-discard");
      // Held exclusive lock verifies save blocks exit until the write resolves.
      await evaluate(
        `window.__lockRequest=navigator.locks.request.bind(navigator.locks);navigator.locks.request=function(...args){if(window.__holdTheme){return new Promise(resolve=>{window.__releaseTheme=()=>{window.__holdTheme=false;resolve(window.__lockRequest(...args))}})}return window.__lockRequest(...args)};window.__holdTheme=true`,
      );
      await click(`[data-theme-card="${red}"] .pick-card__edit`);
      await set("#custom-name", "Held save");
      await click("#custom-save");
      await click("#settings-close");
      expect(await opened()).toBe(true);
      expect(
        await evaluate<boolean>(
          `document.querySelector('#custom-save').disabled`,
        ),
      ).toBe(true);
      await evaluate(`window.__releaseTheme()`);
      await wait(250);
      expect(
        await evaluate<boolean>(`!document.querySelector('#custom-name')`),
      ).toBe(true);
      await browser.command("Page.reload");
      await wait(900);
      expect(await theme()).toBe(copyId);
      await click("#settings-open");
      await wait(350);
      await click("#theme-tab-custom");
      expect(await count()).toBe(4);
      expect(
        await evaluate<boolean>(
          `[...document.querySelectorAll('.pick-card__name')].some(e=>e.textContent==='Held save')`,
        ),
      ).toBe(true);
      // Removing the invoking item while its clean editor is open uses a stable fallback.
      const removedId = await evaluate<string>(
        `[...document.querySelectorAll('[data-custom-theme]')].find(e=>e.dataset.customTheme!==${JSON.stringify(red)}&&e.dataset.customTheme!==${JSON.stringify(copyId)}).dataset.customTheme`,
      );
      await click(`[data-theme-card="${removedId}"] .pick-card__edit`);
      const collection = await evaluate<string>(
        `localStorage.getItem('lightfield:custom-themes')`,
      );
      await evaluate(
        `(()=>{const key='lightfield:custom-themes',oldValue=localStorage.getItem(key),newValue=JSON.stringify(JSON.parse(oldValue).filter(t=>t.id!==${JSON.stringify(removedId)}));localStorage.setItem(key,newValue);window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue,storageArea:localStorage}))})()`,
      );
      await wait(100);
      await click("#custom-cancel");
      expect(await evaluate<string>(`document.activeElement.id`)).toBe(
        "custom-create",
      );
      await evaluate(
        `(()=>{const key='lightfield:custom-themes',oldValue=localStorage.getItem(key),newValue=${JSON.stringify(collection)};localStorage.setItem(key,newValue);window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue,storageArea:localStorage}))})()`,
      );
      await wait(100);
      const screenshot = async (label: string) => {
        const artifacts = process.env.LIGHTFIELD_UI_ARTIFACTS;
        if (!artifacts) return;
        const image = (await browser.command("Page.captureScreenshot", {
          format: "png",
        })) as { data: string };
        await Bun.write(
          join(artifacts, label + ".png"),
          Buffer.from(image.data, "base64"),
        );
      };
      const managedLayout = async (menu: boolean) => {
        const metrics = await evaluate<{
          widthFits: boolean;
          menuInside: boolean;
        }>(
          `(()=>{const p=document.querySelector('.sheet__panel').getBoundingClientRect(),elements=[...document.querySelectorAll('#custom-theme-editor input,#custom-theme-editor button,[role="menu"] button')],m=document.querySelector('[role="menu"]')?.getBoundingClientRect();return {widthFits:elements.every(e=>{const r=e.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right}),menuInside:!m||(m.top>=p.top&&m.bottom<=p.bottom&&m.left>=p.left&&m.right<=p.right)}})()`,
        );
        expect(metrics.widthFits).toBe(true);
        if (menu) expect(metrics.menuInside).toBe(true);
        await shellGeometry();
      };
      const geometry = async (label: string) => {
        await reveal("#theme-picker");
        await shellGeometry();
        await wait(100);
        const metrics = await evaluate<{
          height: number;
          collision: boolean;
          overflow: boolean;
        }>(
          `(()=>{const cards=[...document.querySelectorAll('.theme-library-card')].filter(e=>e.checkVisibility());return {height:cards[0].getBoundingClientRect().height,collision:cards.some(c=>{const s=c.querySelector('.pick-card__swatches i:last-child').getBoundingClientRect(),a=c.querySelector('.theme-card-actions').getBoundingClientRect();return s.right>a.left}),overflow:document.querySelector('.settings-content').scrollWidth>document.querySelector('.settings-content').clientWidth}})()`,
        );
        console.log(label, JSON.stringify(metrics));
        expect(metrics.height).toBeGreaterThanOrEqual(57);
        expect(metrics.height).toBeLessThanOrEqual(60);
        expect(metrics.collision).toBe(false);
        expect(metrics.overflow).toBe(false);
        const artifacts = process.env.LIGHTFIELD_UI_ARTIFACTS;
        if (artifacts) {
          const image = (await browser.command("Page.captureScreenshot", {
            format: "png",
          })) as { data: string };
          await Bun.write(
            join(artifacts, `themes-${label}.png`),
            Buffer.from(image.data, "base64"),
          );
        }
      };
      await geometry("desktop");
      for (const mode of ["drawer", "modal"] as const) {
        await click(`input[name="settingsPresentation"][value="${mode}"]`);
        await wait(450);
        for (const width of [390, 320]) {
          await browser.command("Emulation.setDeviceMetricsOverride", {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await wait(200);
          await click("#theme-tab-custom");
          await geometry(`custom-${mode}-${String(width)}`);
          const card = `[data-theme-card="${red}"]`;
          await click(`${card} .theme-more`);
          await managedLayout(true);
          await screenshot(`menu-${mode}-${String(width)}`);
          await click('[role="menuitem"]:nth-child(2)');
          await managedLayout(false);
          const artifacts = process.env.LIGHTFIELD_UI_ARTIFACTS;
          if (artifacts) {
            const image = (await browser.command("Page.captureScreenshot", {
              format: "png",
            })) as { data: string };
            await Bun.write(
              join(artifacts, `editor-${mode}-${String(width)}.png`),
              Buffer.from(image.data, "base64"),
            );
          }
          await click("#custom-cancel");
          expect(
            await evaluate<string>(
              `document.activeElement.getAttribute('aria-label')`,
            ),
          ).toBe("More actions for Held save");
          await shellGeometry();
          await click("#theme-tab-presets");
          expect(
            await evaluate<number>(
              `document.querySelectorAll('[data-theme-card]').length`,
            ),
          ).toBe(36);
          await geometry(`presets-${mode}-${String(width)}`);
          await click('[data-theme-card="ivory"] .pick-card__edit');
          await shellGeometry();
          await click("#custom-cancel");
          expect(
            await evaluate<string>(
              `document.activeElement.getAttribute('aria-label')`,
            ),
          ).toBe("Customize Ivory");
          await shellGeometry();
        }
      }
      console.log(
        "Real main UI: 36 presets, authored inactive customization, nonactivating saves, native selection, CRUD/undo, owned export/import/reload, semantic red/green outline, local preview, dirty exit, failed/held save and compact responsive geometry passed.",
      );
    } finally {
      cdp?.close();
      browserProcess.kill();
      await browserProcess.exited;
      await server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  60000,
);
