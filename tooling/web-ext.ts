import { dirname, resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import type { Readable, Writable } from "node:stream";

// web-ext's pinned internal adapters are not exposed through its package exports.
const directory = dirname(Bun.resolveSync("web-ext", import.meta.dir));
interface CdpResult {
  id?: string;
  sessionId?: string;
  targetId?: string;
  targetInfos?: { targetId: string; type: string; url: string }[];
  result?: { value?: unknown };
}
export interface ChromiumRunner {
  run(): Promise<void>;
  registerCleanup(callback: () => void): void;
  exit(): Promise<void>;
  exiting: boolean;
  cdp: {
    sendCommand(
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ): Promise<CdpResult>;
  };
  chromiumInstance: { process: { pid: number } };
}
export interface FirefoxRemote {
  installTemporaryAddon(path: string, devtools: boolean): Promise<unknown>;
  getInstalledAddon(
    id: string,
  ): Promise<{ actor: string; manifestURL: string }>;
  disconnect(): void;
  client: {
    request(
      request: string | Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
  };
}
export const chromiumModule = (await import(
  resolve(directory, "lib/extension-runners/chromium.js")
)) as {
  ChromiumExtensionRunner: new (
    params: Record<string, unknown>,
  ) => ChromiumRunner;
};
const firefoxModule = (await import(
  resolve(directory, "lib/firefox/remote.js")
)) as {
  RemoteFirefox: new (client: FirefoxClient) => FirefoxRemote;
  findFreeTcpPort(): Promise<number>;
};
export const findFirefoxPort = () => firefoxModule.findFreeTcpPort();
interface FirefoxClient {
  connect(port: number): Promise<FirefoxClient>;
  disconnect(): void;
  on(event: string, listener: () => void): void;
  emit(event: string, packet: Record<string, unknown>): boolean;
  _handleMessage(packet: Record<string, unknown>): void;
  _rdpConnection?: Socket;
}
const firefoxClientModule = (await import(
  resolve(directory, "lib/firefox/rdp-client.js")
)) as {
  default: new () => FirefoxClient;
};

class FirefoxNotificationClient extends firefoxClientModule.default {
  override _handleMessage(packet: Record<string, unknown>) {
    // Firefox listAddons subscribes to this root event, omitted by web-ext
    // 10.7.0's unsolicited set. Otherwise it consumes the next root reply.
    if (
      packet.from === "root" &&
      packet.type === "addonListChanged" &&
      !packet.error
    ) {
      this.emit("unsolicited-event", packet);
      return;
    }
    super._handleMessage(packet);
  }
}

// Retain the client before its root handshake resolves. web-ext's onEnd only
// emits an event; explicitly disconnect to reject its pending root/request replies.
export function createFirefoxConnection() {
  const client = new FirefoxNotificationClient();
  let disconnected = false;
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    const socket = client._rdpConnection;
    client.disconnect();
    socket?.destroy();
  };
  client.on("end", disconnect);
  const remote = new firefoxModule.RemoteFirefox(client);
  remote.disconnect = disconnect;
  return {
    remote,
    connect: (port: number) => client.connect(port),
    disconnect,
  };
}

interface ChromeLauncher {
  launch(): Promise<void>;
  kill(): void;
  chromeProcess?: ChildProcess;
  remoteDebuggingPipes?: { incoming: Readable; outgoing: Writable };
}
const chromeLauncher = (await import(
  Bun.resolveSync("chrome-launcher", directory)
)) as {
  Launcher: new (options: Record<string, unknown>) => ChromeLauncher;
};

// Keep the launcher before adapter setup awaits CDP. Runner.exit() waits for
// setup, so shutdown must kill the owned process and close its pipes first.
export function createChromiumLaunch(signal: AbortSignal) {
  let launcher: ChromeLauncher | undefined;
  const terminate = () => {
    launcher?.kill();
    launcher?.remoteDebuggingPipes?.incoming.destroy();
    launcher?.remoteDebuggingPipes?.outgoing.destroy();
  };
  signal.addEventListener("abort", terminate, { once: true });
  return {
    launch: async (options: Record<string, unknown>) => {
      // Setup may still be awaiting profile I/O when the owner is cancelled.
      // Refuse a late launch, and terminate any launch interrupted in progress.
      signal.throwIfAborted();
      launcher = new chromeLauncher.Launcher(options);
      await launcher.launch();
      if (signal.aborted) {
        terminate();
        signal.throwIfAborted();
      }
      return {
        process: launcher.chromeProcess,
        remoteDebuggingPipes: launcher.remoteDebuggingPipes,
        kill: () => launcher?.kill(),
      };
    },
    terminate,
  };
}
