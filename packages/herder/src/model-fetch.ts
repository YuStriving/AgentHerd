// Model requests leave the process through the system proxy (ADR 0098). Without it the owner's
// gateway is unreachable from here: Node reads NODE_USE_ENV_PROXY only when the process starts,
// and AgentHerd learns the system proxy after it is up (`packages/host/src/proxy.ts`), so the
// proxy has to travel with the request itself. That module also fills NO_PROXY, so the services
// this computer reaches directly (deepseek, this machine) never go through the proxy.

import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";

/** The variables the proxy is read from. */
export type ProxyEnv = Record<string, string | undefined>;

let cached: typeof fetch | undefined;

/**
 * `fetch` for model requests. Built on first use, so it sees what `applySystemProxy` wrote at
 * start; without a proxy in the environment it is the plain `fetch`.
 */
export function modelFetch(): typeof fetch {
  cached ??= createModelFetch(process.env);
  return cached;
}

/** `fetch` that follows `HTTPS_PROXY`/`HTTP_PROXY`, with `NO_PROXY` staying direct. */
export function createModelFetch(env: ProxyEnv): typeof fetch {
  const httpProxy = proxyValue(env, "http_proxy") ?? proxyValue(env, "HTTP_PROXY");
  const httpsProxy = proxyValue(env, "https_proxy") ?? proxyValue(env, "HTTPS_PROXY");
  if (httpProxy === undefined && httpsProxy === undefined) return fetch;
  let dispatcher: EnvHttpProxyAgent;
  try {
    dispatcher = new EnvHttpProxyAgent({
      ...(httpProxy === undefined ? {} : { httpProxy }),
      ...(httpsProxy === undefined ? {} : { httpsProxy }),
      noProxy: direct(proxyValue(env, "no_proxy") ?? proxyValue(env, "NO_PROXY")),
    });
  } catch {
    // A URL parser error can carry the raw proxy URL, including credentials.
    throw new Error("Invalid model proxy configuration. Check HTTP_PROXY and HTTPS_PROXY.");
  }
  return ((input: string | URL | Request, init?: RequestInit) =>
    proxyFetch(input as never, { ...init, dispatcher } as never)) as typeof fetch;
}

function proxyValue(env: ProxyEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** The addresses this computer answers itself; they never go through a proxy. */
// Undici matches against the URL hostname, including brackets for IPv6.
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** `noProxy` with this computer's own addresses added, so a model served here stays direct. */
function direct(noProxy: string | undefined): string {
  if (noProxy === "*") return noProxy;
  const entries = (noProxy ?? "").split(/[,\s]+/).filter((entry) => entry !== "");
  for (const host of LOOPBACK) if (!entries.includes(host)) entries.push(host);
  return entries.join(",");
}
