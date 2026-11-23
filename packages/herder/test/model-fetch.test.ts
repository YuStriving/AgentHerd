import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createModelFetch } from "../src/model-fetch.ts";

const open: Server[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise<void>((done) => s.close(() => done()))));
});

/** A local HTTP server answering with what it was asked for. */
async function serve(fn: (url: string) => string, host = "127.0.0.1"): Promise<number> {
  const server = createHttpServer((req, res) => res.end(fn(req.url ?? "")));
  open.push(server);
  await new Promise<void>((done, reject) => server.once("error", reject).listen(0, host, done));
  return (server.address() as AddressInfo).port;
}

/** A local proxy that records the CONNECT tunnels asked for and then drops them. */
async function proxyRecording(tunnels: string[]): Promise<number> {
  const server = createHttpServer();
  server.on("connect", (req, socket) => {
    tunnels.push(req.url ?? "");
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  open.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return (server.address() as AddressInfo).port;
}

describe("model requests and the system proxy (ADR 0098)", () => {
  it("is the plain fetch when there is no proxy", () => {
    expect(createModelFetch({})).toBe(fetch);
  });

  it("goes through HTTP_PROXY for a service NO_PROXY does not name", async () => {
    const tunnels: string[] = [];
    const proxy = await proxyRecording(tunnels);
    const doFetch = createModelFetch({ HTTP_PROXY: `http://127.0.0.1:${proxy}` });
    await expect(doFetch("http://model.invalid/v1/models")).rejects.toThrow();
    expect(tunnels).toEqual(["model.invalid:80"]);
  });

  it("keeps an IPv6 loopback model direct even without NO_PROXY", async () => {
    const tunnels: string[] = [];
    const proxy = await proxyRecording(tunnels);
    const port = await serve((url) => `direct ${url}`, "::1");
    const doFetch = createModelFetch({ HTTP_PROXY: `http://127.0.0.1:${proxy}` });
    const res = await doFetch(`http://[::1]:${port}/v1/models`);
    expect(await res.text()).toBe("direct /v1/models");
    expect(tunnels).toEqual([]);
  });

  it("keeps what NO_PROXY names direct", async () => {
    const tunnels: string[] = [];
    const proxy = await proxyRecording(tunnels);
    const direct = await serve((url) => `direct ${url}`);
    const doFetch = createModelFetch({
      HTTP_PROXY: `http://127.0.0.1:${proxy}`,
      NO_PROXY: "127.0.0.1,api.deepseek.com",
    });
    const res = await doFetch(`http://127.0.0.1:${direct}/v1/models`);
    expect(await res.text()).toBe("direct /v1/models");
    expect(tunnels).toEqual([]);
  });
});
