import { expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createChromiumLaunch, createFirefoxConnection } from "./web-ext";
import { waitForBrowser } from "./dev-lifecycle";
import { root } from "./paths";

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return;
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for owned protocol fixture");
}

test("interrupted Firefox root handshake rejects and destroys the owned socket", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });
  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const connection = createFirefoxConnection();
  const cancellation = new AbortController();
  const handshake = waitForBrowser(
    connection.connect(address.port),
    "Firefox root handshake",
    cancellation.signal,
    500,
  );
  const outcome = handshake.then(
    () => "connected",
    (error: unknown) => error,
  );
  try {
    await until(() => Promise.resolve(sockets.size === 1));
    cancellation.abort(new Error("test cancellation"));
    connection.disconnect();
    expect(await outcome).toBeInstanceOf(Error);
    await until(() => Promise.resolve(sockets.size === 0));
  } finally {
    connection.disconnect();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => {
      server.close(() => {
        done();
      });
    });
  }
});

test("late Chromium adapter setup refuses to launch after cancellation", async () => {
  const cancellation = new AbortController();
  const owner = createChromiumLaunch(cancellation.signal);
  const reason = new Error("setup cancelled before spawn");
  cancellation.abort(reason);
  const outcome = await owner.launch({}).catch((error: unknown) => error);
  expect(outcome).toBe(reason);
  owner.terminate();
});

test("protocol deadlines settle stalled replies", async () => {
  const start = Date.now();
  const result = await waitForBrowser(
    new Promise<void>(() => {}),
    "stalled CDP",
    undefined,
    20,
  ).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Error);
  expect(String(result)).toContain("stalled CDP timed out");
  expect(Date.now() - start).toBeLessThan(500);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`cancellation during suspended initial snapshot creates no watchers (${signal})`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
import { mock } from 'bun:test';
import fs from 'node:fs';
import { access } from 'node:fs/promises';
let watchers = 0;
mock.module('node:fs', () => ({ ...fs, watch: (...args) => { watchers++; return fs.watch(...args); } }));
mock.module('./tooling/managed-browsers.ts', () => ({ resolveManagedBinary: async () => '/unused-owned-browser' }));
const { DevelopmentInputs } = await import('./tooling/dev-inputs.ts');
let release;
DevelopmentInputs.prototype.changed = () => new Promise(resolve => {
  release = () => resolve(true);
  console.log('SNAPSHOT_SUSPENDED');
});
process.once('${signal}', () => { setTimeout(() => release(), 0); });
const { launchBrowsers } = await import('./tooling/dev-browsers.ts');
const start = Date.now();
const session = await launchBrowsers(true);
await session.stop();
const removed = await access(session.owned).then(() => false, () => true);
console.log('SNAPSHOT_CANCELLED:' + JSON.stringify({ watchers, removed, owned: session.owned, elapsed: Date.now() - start }));
`,
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    let output = "";
    const collecting = (async () => {
      for await (const chunk of child.stdout)
        output += new TextDecoder().decode(chunk);
    })();
    const errors = new Response(child.stderr).text();
    try {
      await until(() => Promise.resolve(output.includes("SNAPSHOT_SUSPENDED")));
      const started = Date.now();
      child.kill(signal);
      expect(
        await waitForBrowser(
          child.exited,
          "Suspended snapshot cleanup",
          undefined,
          3000,
        ),
      ).toBe(0);
      await collecting;
      const line = output
        .split("\n")
        .find((line) => line.startsWith("SNAPSHOT_CANCELLED:"));
      if (!line) throw new Error(`${output}\n${await errors}`);
      const result = JSON.parse(line.slice("SNAPSHOT_CANCELLED:".length)) as {
        watchers: number;
        removed: boolean;
        owned: string;
        elapsed: number;
      };
      expect(result.watchers).toBe(0);
      expect(result.removed).toBe(true);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(access(result.owned)).rejects.toThrow();
      console.log(
        `${signal} suspended snapshot: watchers=${String(result.watchers)}; owned removed=${String(result.removed)}; shutdown=${String(Date.now() - started)}ms.`,
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await child.exited;
      await collecting;
      await errors;
    }
  }, 10000);
}

// Protocol-only executable doubles exercise the actual pinned adapters and owner,
// with real owned processes/pipes/sockets. They are never application consumers.
const browserFixture = `
import { appendFileSync, createReadStream, createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
const args = process.argv.slice(2);
const browser = args.shift();
const log = (event, extra = {}) => appendFileSync(process.env.LIGHTFIELD_TEST_RECORD, JSON.stringify({event, browser, pid: process.pid, ...extra}) + '\\n');
if (args.includes('--version')) { console.log(browser === 'chromium' ? 'Chromium 151.0.0.0' : 'Mozilla Firefox 157.0.1'); process.exit(0); }
const profile = browser === 'chromium' ? args.find(a => a.startsWith('--user-data-dir=')).split('=').slice(1).join('=') : args[args.indexOf('-profile') + 1];
if (!profile || !(browser === 'chromium' ? args.includes('--headless=new') : args.includes('--headless') && process.env.MOZ_HEADLESS === '1')) process.exit(90);
log('spawn', {profile, ...(browser === 'firefox' ? {port:Number(args[args.indexOf('-start-debugger-server') + 1])} : {})});
if (browser === 'firefox' && process.env.LIGHTFIELD_TEST_MODE === 'early-exit') process.exit(23);
let url = 'about:blank';
if (browser === 'chromium') {
  const incoming = createReadStream(null, {fd: 3});
  const outgoing = createWriteStream(null, {fd: 4});
  let data = '';
  incoming.on('data', chunk => {
    data += chunk;
    while (data.includes('\\0')) {
      const end = data.indexOf('\\0'); const message = JSON.parse(data.slice(0, end)); data = data.slice(end + 1);
      log(message.method);
      if (process.env.LIGHTFIELD_TEST_MODE.startsWith('startup-') || message.method === 'Page.reload' && process.env.LIGHTFIELD_TEST_MODE.startsWith('reload-')) continue;
      let result = {};
      if (message.method === 'Extensions.loadUnpacked') result = {id:'lightfieldtest'};
      if (message.method === 'Target.getTargets') result = {targetInfos:[{targetId:'page',type:'page',url}]};
      if (message.method === 'Target.attachToTarget') result = {sessionId:'session'};
      if (message.method === 'Page.navigate') url = message.params.url;
      if (message.method === 'Runtime.evaluate') result = {result:{value: message.params.expression === 'location.href' ? url : message.params.expression.includes('JSON.stringify') ? JSON.stringify({status:'done'}) : true}};
      outgoing.write(JSON.stringify({id:message.id,result}) + '\\0');
    }
  });
} else {
  const port = Number(args[args.indexOf('-start-debugger-server') + 1]);
  createServer(socket => {
    log('connection');
    if (process.env.LIGHTFIELD_TEST_MODE.startsWith('handshake-')) return;
    const send = value => { const text = JSON.stringify(value); socket.write(Buffer.byteLength(text) + ':' + text); };
    send({from:'root',applicationType:'browser',traits:{}});
    let data = '';
    socket.on('data', chunk => {
      data += chunk;
      while (data.includes(':')) {
        const colon = data.indexOf(':'); const length = Number(data.slice(0,colon)); if (data.length < colon + 1 + length) break;
        const message = JSON.parse(data.slice(colon+1,colon+1+length)); data=data.slice(colon+1+length);
        let result = {from:message.to};
        if (message.type === 'getRoot') result.addonsActor='addons';
        if (message.type === 'installTemporaryAddon') result.addon={id:'lightfield-development@example.invalid'};
        if (message.type === 'listAddons') result.addons=[{id:'lightfield-development@example.invalid',actor:'addon',manifestURL:'moz-extension://lightfieldtest/manifest.json'}];
        if (message.type === 'listTabs') result.tabs=[{actor:'tab',url,traits:{supportsNavigation:true}}];
        if (message.type === 'navigateTo') url=message.url;
        if (message.type === 'getTarget') result.frame={webExtensionInspectedWindowActor:'inspected-window'};
        if (message.type === 'eval') {
          log('fixture-eval');
          if (process.env.LIGHTFIELD_TEST_MODE === 'fixture-stall') continue;
          result.evalResult={value:message.expression.startsWith('JSON.stringify') ? JSON.stringify({status:'pending'}) : true};
        }
        send(result);
      }
    });
  }).listen(port,'127.0.0.1');
}
`;

for (const mode of [
  "startup-stall",
  "startup-timeout",
  "reload-stall",
  "reload-timeout",
  "handshake-stall",
  "handshake-timeout",
  "early-exit",
  "ready-close",
  "fixture-stall",
  "fixture-timeout",
] as const) {
  test.skipIf(process.platform === "win32")(
    `owned cleanup for ${mode}`,
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "lightfield-cancellation-test-"),
      );
      const record = join(directory, "record.jsonl");
      await writeFile(record, "");
      const fixture = join(directory, "browser.mjs");
      await writeFile(fixture, browserFixture);
      for (const browser of ["chromium", "firefox"]) {
        const executable = join(directory, browser);
        await writeFile(
          executable,
          `#!/bin/sh\nexec '${process.execPath}' '${fixture}' '${browser}' "$@"\n`,
        );
        await chmod(executable, 0o700);
      }
      const child = Bun.spawn(
        // Existing non-app cases bypass fixtures. Fixture-phase cases implement
        // only seed completion replies, with a deferred/pending Firefox eval.
        [
          process.execPath,
          "tooling/dev-browsers.ts",
          "--headless",
          ...(mode.startsWith("fixture-") ? [] : ["--no-fixtures"]),
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            LIGHTFIELD_CHROMIUM_BINARY: join(directory, "chromium"),
            LIGHTFIELD_FIREFOX_BINARY: join(directory, "firefox"),
            LIGHTFIELD_TEST_RECORD: record,
            LIGHTFIELD_TEST_MODE: mode,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      let output = "";
      const collecting = (async () => {
        for await (const chunk of child.stdout)
          output += new TextDecoder().decode(chunk);
      })();
      const errors = new Response(child.stderr).text();
      const events = async () =>
        (await readFile(record, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(
            (line) =>
              JSON.parse(line) as {
                event: string;
                browser: string;
                pid: number;
                profile?: string;
                port?: number;
              },
          );
      const config = resolve(root, "vite.config.ts");
      const previousTimes = await stat(config);
      const originalConfig = await readFile(config, "utf8");
      try {
        if (mode.startsWith("startup-"))
          await until(async () =>
            (await events()).some(
              (event) => event.event === "Extensions.loadUnpacked",
            ),
          );
        if (mode.startsWith("handshake-"))
          await until(
            async () =>
              (await events()).filter((event) => event.event === "connection")
                .length >= 2,
          );
        if (mode.startsWith("reload-") || mode === "ready-close") {
          await until(() =>
            Promise.resolve(output.includes("lightfield ready")),
          );
          if (mode.startsWith("reload-")) {
            await writeFile(
              config,
              originalConfig + "\n// cancellation fixture source edit\n",
            );
            await until(async () =>
              (await events()).some((event) => event.event === "Page.reload"),
            );
          }
        }
        if (mode.startsWith("fixture-"))
          await until(async () =>
            (await events()).some((event) => event.event === "fixture-eval"),
          );
        if (mode === "early-exit")
          await until(async () =>
            (await events()).some(
              (event) => event.browser === "firefox" && event.event === "spawn",
            ),
          );
        const started = Date.now();
        if (mode === "ready-close") {
          const firefox = (await events()).find(
            (event) => event.browser === "firefox" && event.event === "spawn",
          );
          if (!firefox) throw new Error("No owned Firefox");
          process.kill(firefox.pid, "SIGTERM");
        } else if (mode !== "early-exit" && !mode.endsWith("timeout"))
          child.kill("SIGTERM");
        const exit = await waitForBrowser(
          child.exited,
          "Test launcher shutdown",
          undefined,
          mode === "startup-timeout"
            ? 35000
            : mode.endsWith("timeout")
              ? 15000
              : 5000,
        );
        expect(Date.now() - started).toBeLessThan(
          mode === "startup-timeout"
            ? 35000
            : mode.endsWith("timeout")
              ? 15000
              : 5000,
        );
        expect(exit).toBe(
          mode === "early-exit" ||
            mode === "startup-timeout" ||
            mode === "handshake-timeout" ||
            mode === "fixture-timeout"
            ? 1
            : 0,
        );
        if (mode === "early-exit")
          expect(await errors).toContain(
            "Firefox exited before readiness (exit code 23",
          );
        if (mode.startsWith("fixture-")) {
          await collecting;
          expect(output).not.toContain("lightfield ready");
          const recorded = await events();
          expect(
            recorded
              .filter((event) => event.event === "spawn")
              .map((event) => event.browser)
              .sort(),
          ).toEqual(["chromium", "firefox"]);
          const port = recorded.find(
            (event) => event.browser === "firefox" && event.event === "spawn",
          )?.port;
          if (!port) throw new Error("Missing owned Firefox transport port");
          // Probe TCP directly: the pinned RDP client does not reject connect
          // on a refused socket until its handshake deadline.
          const result = await waitForBrowser(
            Bun.connect({
              hostname: "127.0.0.1",
              port,
              socket: { data() {} },
            }).then((socket) => {
              socket.end();
              return "unexpected connection";
            }),
            "Closed fixture transport",
            undefined,
            1000,
          ).catch((error: unknown) => error);
          expect(result).toBeInstanceOf(Error);
          expect(result).toMatchObject({ code: "ECONNREFUSED" });
          if (mode === "fixture-timeout")
            expect(await errors).toContain(
              "Development theme fixtures timed out awaiting extension storage",
            );
        }
        for (const event of await events()) {
          if (event.event !== "spawn" || !event.profile) continue;
          expect(() => process.kill(event.pid, 0)).toThrow();
          expect(access(dirname(event.profile))).rejects.toThrow();
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGTERM");
        await waitForBrowser(
          child.exited,
          "Fixture launcher cleanup",
          undefined,
          6000,
        );
        await collecting;
        await errors;
        if (mode.startsWith("reload-")) await writeFile(config, originalConfig);
        await utimes(config, previousTimes.atime, previousTimes.mtime);
        await rm(directory, { recursive: true, force: true });
      }
    },
    45000,
  );
}
