// A small Chrome DevTools Protocol client (ADR 0058): 知乎 runs in a headless Chrome with its own
// profile, so the site's own scripts sign every request. This launches that Chrome, opens pages,
// evaluates scripts in them and reads the answers the pages fetched.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { win32 } from "node:path";
import { killTree } from "@agentherd/acp-client";
import { envValue } from "./profiles.ts";

/** Where Chrome usually is on macOS. */
const MAC_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
/** Where Chrome/Chromium/Edge usually are on Linux. */
const LINUX_CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
];
const START_MS = 20_000;
const CALL_MS = 30_000;

export function findChrome(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (platform === "win32") {
    const pf = envValue(env, "ProgramFiles") ?? "C:\\Program Files";
    const pf86 = envValue(env, "ProgramFiles(x86)") ?? "C:\\Program Files (x86)";
    const local = envValue(env, "LOCALAPPDATA");
    const candidates = [
      win32.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      win32.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(local === undefined || local === ""
        ? []
        : [win32.join(local, "Google", "Chrome", "Application", "chrome.exe")]),
      win32.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      win32.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
    return candidates.find((p) => exists(p));
  }
  const paths = platform === "darwin" ? MAC_CHROME_PATHS : LINUX_CHROME_PATHS;
  return paths.find((p) => exists(p));
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An answer a page fetched from the site's API. */
export interface PageResponse {
  url: string;
  status: number;
  body: string;
}

/** One tab. */
export class CdpPage {
  private id = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly seen: { requestId: string; url: string; status: number }[] = [];
  private closed = false;

  private readonly ws: WebSocket;
  readonly targetId: string;

  constructor(ws: WebSocket, targetId: string) {
    this.ws = ws;
    this.targetId = targetId;
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: { requestId: string; response: { url: string; status: number } };
      };
      if (d.id !== undefined) {
        const p = this.pending.get(d.id);
        if (p === undefined) return;
        this.pending.delete(d.id);
        if (d.error !== undefined) p.reject(new Error(d.error.message));
        else p.resolve(d.result);
        return;
      }
      if (d.method === "Network.responseReceived" && d.params !== undefined) {
        const { requestId, response } = d.params;
        if (response.url.includes("/api/")) {
          this.seen.push({ requestId, url: response.url, status: response.status });
        }
      }
    };
    ws.onclose = () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error("the page closed"));
      this.pending.clear();
    };
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("the page closed"));
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} took too long`));
      }, CALL_MS);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Opens a URL and waits for the page and its first requests to settle. */
  async go(url: string, settleMs = 3_000): Promise<void> {
    this.seen.length = 0;
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'", 20_000);
    await sleep(settleMs);
  }

  /** Runs a script in the page and returns its value (promises are awaited). */
  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send<{
      result: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails !== undefined) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value as T;
  }

  /** Waits until an expression is true in the page. */
  async waitFor(expression: string, ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      try {
        if (await this.evaluate<boolean>(`Boolean(${expression})`)) return true;
      } catch {
        // the page is changing
      }
      await sleep(300);
    }
    return false;
  }

  /** The API answers the page fetched since the last `go`, whose URL contains `part`. */
  async responses(part: string): Promise<PageResponse[]> {
    const out: PageResponse[] = [];
    for (const r of this.seen.filter((s) => s.url.includes(part))) {
      try {
        const b = await this.send<{ body: string; base64Encoded: boolean }>(
          "Network.getResponseBody",
          { requestId: r.requestId },
        );
        const body = b.base64Encoded ? Buffer.from(b.body, "base64").toString("utf8") : b.body;
        out.push({ url: r.url, status: r.status, body });
      } catch {
        // the body is gone
      }
    }
    return out;
  }

  /** A PNG of one element, as a data URL. */
  async shot(selector: string): Promise<string | undefined> {
    const box = await this.evaluate<{ x: number; y: number; w: number; h: number } | null>(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`,
    );
    if (box === null || box.w === 0) return undefined;
    const s = await this.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      clip: { x: box.x - 8, y: box.y - 8, width: box.w + 16, height: box.h + 16, scale: 3 },
    });
    return `data:image/png;base64,${s.data}`;
  }

  async cookies(url: string): Promise<{ name: string; value: string }[]> {
    const r = await this.send<{ cookies: { name: string; value: string }[] }>(
      "Network.getCookies",
      { urls: [url] },
    );
    return r.cookies;
  }

  close(): void {
    this.ws.close();
  }
}

/** Options when launching the isolated Chrome/Edge process (ADR 0058, ADR 0077). */
export interface ChromeStartOptions {
  /** Default true (`--headless=new`). Set false for interactive login windows. */
  headless?: boolean;
  /** Initial URL (or `--app=<url>` when `headless: false`). */
  url?: string;
  /** Chrome `--window-size` argument. */
  windowSize?: string;
}

/** A headless or app-window Chrome with its own profile folder. */
export class Chrome {
  private child: ChildProcess | undefined;
  private port = 0;

  private readonly profile: string;
  private readonly onExit: (code: number | null) => void;

  constructor(profile: string, onExit: (code: number | null) => void) {
    this.profile = profile;
    this.onExit = onExit;
  }

  running(): boolean {
    return this.child !== undefined;
  }

  async start(opts?: ChromeStartOptions): Promise<void> {
    if (this.child !== undefined) return;
    const bin = findChrome();
    if (bin === undefined) throw new Error("需要先安装 Google Chrome 或 Microsoft Edge");
    mkdirSync(this.profile, { recursive: true, mode: 0o700 });
    this.port = await freePort();
    const headless = opts?.headless !== false;
    const args = headless
      ? [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${this.profile}`,
          `--remote-debugging-port=${this.port}`,
          "--remote-debugging-address=127.0.0.1",
          `--window-size=${opts?.windowSize ?? "1280,900"}`,
          opts?.url ?? "about:blank",
        ]
      : [
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${this.profile}`,
          `--remote-debugging-port=${this.port}`,
          "--remote-debugging-address=127.0.0.1",
          `--window-size=${opts?.windowSize ?? "520,740"}`,
          `--app=${opts?.url ?? "about:blank"}`,
        ];
    const child = spawn(bin, args, { stdio: "ignore", windowsHide: headless });
    this.child = child;
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.onExit(code);
    });
    const until = Date.now() + START_MS;
    while (Date.now() < until) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await sleep(300);
    }
    this.stop();
    throw new Error("Chrome 没有启动起来");
  }

  /** Attaches to an existing page tab (useful when started with a URL / `--app`), or opens one. */
  async firstPage(): Promise<CdpPage> {
    const until = Date.now() + 5_000;
    while (Date.now() < until && this.child !== undefined) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        if (res.ok) {
          const targets = (await res.json()) as {
            id?: string;
            type?: string;
            webSocketDebuggerUrl?: string;
          }[];
          const found = targets.find(
            (t) => t.type === "page" && t.id !== undefined && t.webSocketDebuggerUrl !== undefined,
          );
          if (found?.id !== undefined && found.webSocketDebuggerUrl !== undefined) {
            const ws = new WebSocket(found.webSocketDebuggerUrl);
            await new Promise<void>((resolve, reject) => {
              ws.onopen = () => resolve();
              ws.onerror = () => reject(new Error("could not reach the Chrome tab"));
            });
            const page = new CdpPage(ws, found.id);
            await page.send("Page.enable");
            await page.send("Network.enable");
            return page;
          }
        }
      } catch {
        // page not listed yet
      }
      await sleep(200);
    }
    return this.open();
  }

  /** Opens a new tab. */
  async open(url = "about:blank"): Promise<CdpPage> {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/new?${url}`, { method: "PUT" });
    const target = (await res.json()) as { id: string; webSocketDebuggerUrl: string };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("could not reach the Chrome tab"));
    });
    const page = new CdpPage(ws, target.id);
    await page.send("Page.enable");
    await page.send("Network.enable");
    return page;
  }

  /** Closes a tab. */
  async closePage(page: CdpPage): Promise<void> {
    page.close();
    await fetch(`http://127.0.0.1:${this.port}/json/close/${page.targetId}`).catch(() => {});
  }

  /** Sends `Browser.close` so SQLite cookies flush to disk before the process exits. */
  async closeGracefully(): Promise<void> {
    const child = this.child;
    const port = this.port;
    if (child === undefined) return;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 2_500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    let ws: WebSocket | undefined;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (res.ok) {
        const info = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (info.webSocketDebuggerUrl !== undefined) {
          ws = new WebSocket(info.webSocketDebuggerUrl);
          await new Promise<void>((resolve, reject) => {
            if (ws === undefined) return reject(new Error("closed"));
            ws.onopen = () => {
              ws?.send(JSON.stringify({ id: 1, method: "Browser.close" }));
              resolve();
            };
            ws.onerror = () => reject(new Error("ws error"));
          });
        }
      }
    } catch {
      // fall through to exited / force stop
    } finally {
      ws?.close();
    }
    await exited;
    if (this.child === child && child.exitCode === null && child.signalCode === null) {
      this.stop();
    } else if (this.child === child) {
      this.child = undefined;
    }
    await sleep(200);
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    if (child !== undefined) killTree(child, "SIGTERM");
  }
}
