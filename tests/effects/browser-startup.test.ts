import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { BACKGROUND_IMPLEMENTATION_IDS } from "../../src/shared/background-metadata";
import { PAPER_IMAGE_FILTER_IDS } from "../../src/shared/image-filter-metadata";

// Opt-in only: attach to a parent-owned literal-headless Chrome and an already-served production build.
const endpoint = process.env.LIGHTFIELD_STARTUP_CDP;
const pageURL = process.env.LIGHTFIELD_STARTUP_URL;
interface Message {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
  params?: unknown;
}
class Connection {
  private next = 0;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly events: Message[] = [];
  constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      const ticket =
        message.id === undefined ? undefined : this.pending.get(message.id);
      if (!ticket || message.id === undefined) {
        this.events.push(message);
        return;
      }
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
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 10000);
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
  close(): void {
    for (const ticket of this.pending.values()) clearTimeout(ticket.timer);
    this.socket.close();
  }
}
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
interface State {
  id: string;
  error: string;
  canvas: boolean;
  image: boolean;
  filter: string | null;
  filterError: string;
}

test.skipIf(!endpoint || !pageURL)(
  "headless production renderer startup: procedures and native-owned image filters",
  async () => {
    if (!endpoint || !pageURL)
      throw new Error("Explicit CDP/build URL required");
    const url = new URL(endpoint);
    if (url.hostname !== "127.0.0.1")
      throw new Error("Only parent-owned loopback CDP allowed");
    const processes = await Bun.$`ps -axo command`.text();
    if (
      !processes
        .split("\n")
        .some(
          (line) =>
            line.includes("--headless=new") &&
            line.includes(`--remote-debugging-port=${url.port}`),
        )
    )
      throw new Error("Literal-headless parent process not attested");
    const targets = (await (await fetch(`${endpoint}/json/list`)).json()) as {
      type: string;
      webSocketDebuggerUrl?: string;
    }[];
    const target = targets.find(
      (item) => item.type === "page" && item.webSocketDebuggerUrl,
    );
    if (!target?.webSocketDebuggerUrl)
      throw new Error("Existing parent page required; never launch a browser");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const connection = new Connection(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("CDP connect timed out"));
      }, 8000);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP connect failed"));
      };
    });
    const results: unknown[] = [];
    const state = () =>
      connection.evaluate<State>(
        `(()=>{const h=document.querySelector('#background-host'),c=h.querySelector('canvas'),i=h.querySelector('.local-image-background');return {id:h.dataset.background,error:h.dataset.error||'',canvas:!!c&&c.width>0&&c.height>0,image:!!i&&i.complete&&i.naturalWidth>0,filter:h.querySelector('[data-paper-image-ready]')?.dataset.paperImageReady||null,filterError:document.querySelector('#local-image-status')?.textContent||''}})()`,
      );
    async function ready(check: (value: State) => boolean): Promise<State> {
      const deadline = Date.now() + 5000;
      let value = await state();
      while (!value.error && !check(value) && Date.now() < deadline) {
        await wait(100);
        value = await state();
      }
      return value;
    }
    try {
      await connection.command("Page.enable");
      await connection.command("Runtime.enable");
      await connection.command("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await connection.command("Page.navigate", { url: pageURL });
      await wait(1000);
      const ids = process.env.LIGHTFIELD_STARTUP_IDS?.split(",") ?? [
        ...BACKGROUND_IMPLEMENTATION_IDS,
      ];
      for (const id of ids) {
        await connection.evaluate(
          `(()=>{document.querySelector('#settings-open').click();document.querySelector('input[data-setting=background][value=${JSON.stringify(id)}]').click();document.querySelector('[aria-label="Close settings"]').click()})()`,
        );
        await ready((value) => value.id === id && value.canvas);
        await wait(250);
        const value = await state();
        results.push({ requestedId: id, ...value });
        expect(value.error).toBe("");
        expect(value.id).toBe(id);
        expect(value.canvas).toBe(true);
      }
      if (process.env.LIGHTFIELD_STARTUP_OVERRIDES === "1") {
        let firstInk: { opacity?: number } | undefined;
        for (const id of ["ink", "smoke"] as const) {
          const previous = await connection.evaluate<
            Record<string, { opacity?: number }>
          >(
            `JSON.parse(localStorage.getItem('lightfield:settings')).backgroundOverrides`,
          );
          const expected = previous[id]?.opacity === 1 ? 0 : 1;
          const key = expected === 1 ? "End" : "Home";
          await connection.evaluate(
            `(()=>{document.querySelector('#settings-open').click();document.querySelector('input[data-setting=background][value="${id}"]').click()})()`,
          );
          await wait(120);
          await connection.evaluate(
            `document.querySelector('#effect-tune').click()`,
          );
          await wait(120);
          await connection.evaluate(
            `(()=>{const e=document.querySelector('#background-${id}-opacity');if(!e.checkVisibility())throw new Error('Tuner control not visible');e.dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true}));e.dispatchEvent(new KeyboardEvent('keyup',{key:'${key}',bubbles:true}))})()`,
          );
          const deadline = Date.now() + 5000;
          let saved: Record<string, { opacity?: number }> = {};
          do {
            await wait(80);
            saved = await connection.evaluate(
              `JSON.parse(localStorage.getItem('lightfield:settings')).backgroundOverrides`,
            );
          } while (saved[id]?.opacity !== expected && Date.now() < deadline);
          expect(saved[id]?.opacity).toBe(expected);
          if (id === "ink") firstInk = saved.ink;
          else expect(saved.ink).toEqual(firstInk);
          results.push({
            operation: "nested effect override persisted",
            id,
            saved,
          });
          await connection.evaluate(
            `document.querySelector('#effect-tuner-close').click()`,
          );
        }
      }
      if (process.env.LIGHTFIELD_STARTUP_IMAGES === "1") {
        await connection.command("Page.setInterceptFileChooserDialog", {
          enabled: true,
        });
        await connection.evaluate(
          `(()=>{document.querySelector('#settings-open').click();document.querySelector('[data-settings-nav="background"]').click();document.querySelector('input[data-setting=background][value="none"]').click()})()`,
        );
        await wait(150);
        await connection.evaluate(
          `document.querySelector('#local-image-add').scrollIntoView()`,
        );
        const position = await connection.evaluate<{ x: number; y: number }>(
          `(()=>{const r=document.querySelector('#local-image-add').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
        );
        await connection.command("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...position,
          button: "left",
          clickCount: 1,
        });
        await connection.command("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...position,
          button: "left",
          clickCount: 1,
        });
        await wait(150);
        expect(
          connection.events.some(
            (event) => event.method === "Page.fileChooserOpened",
          ),
        ).toBe(true);
        const document = (await connection.command("DOM.getDocument")) as {
          root: { nodeId: number };
        };
        const input = (await connection.command("DOM.querySelector", {
          nodeId: document.root.nodeId,
          selector: "#local-image-file",
        })) as { nodeId: number };
        await connection.command("DOM.setFileInputFiles", {
          nodeId: input.nodeId,
          files: [resolve("tests/fixtures/images/alpha.png")],
        });
        let value = await ready(
          (value) => value.id === "local-image" && value.image,
        );
        results.push({ operation: "owned synthetic image import", ...value });
        expect(value.error).toBe("");
        expect(value.id).toBe("local-image");
        expect(value.image).toBe(true);
        for (const id of PAPER_IMAGE_FILTER_IDS) {
          await connection.evaluate(
            `(()=>{const e=document.querySelector('#local-image-filter');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
          );
          value = await ready((value) => value.filter === id);
          results.push({ requestedFilter: id, ...value });
          expect(value.error).toBe("");
          expect(value.filterError).toBe("");
          expect(value.filter).toBe(id);
          const durable = await connection.evaluate<{
            localImage: { filter: string };
          }>(`JSON.parse(localStorage.getItem('lightfield:settings'))`);
          expect(durable.localImage.filter).toBe(id);
        }
        await connection.evaluate(
          `(()=>{const e=document.querySelector('#local-image-filter');e.value='none';e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
        );
        value = await ready((value) => value.filter === null);
        const original = await connection.evaluate<{
          localImage: { filter: string };
        }>(`JSON.parse(localStorage.getItem('lightfield:settings'))`);
        expect(original.localImage.filter).toBe("none");
        expect(value.image).toBe(true);
        expect(value.filterError).toBe("");
        results.push({ operation: "Original restored through UI", ...value });
        await connection.evaluate(
          `document.querySelector('#local-image-remove').click()`,
        );
        await connection.command("Page.setInterceptFileChooserDialog", {
          enabled: false,
        });
      }
    } finally {
      if (process.env.LIGHTFIELD_STARTUP_RESULTS)
        await Bun.write(
          process.env.LIGHTFIELD_STARTUP_RESULTS,
          JSON.stringify(results, null, 2),
        );
      connection.close();
    }
  },
  180000,
);
