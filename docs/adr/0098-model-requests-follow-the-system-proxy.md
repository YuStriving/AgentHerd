# 0098. Model requests follow the system proxy, domestic services stay direct

- Status: Accepted
- Date: 2026-11-21
- Changes: [0058](0058-xiaohongshu-zhihu-and-watches.md) (adds the model requests to the proxy
  the host learns)

## Context

The owner runs their models through a gateway abroad (`ai-gw.juanji.site`) and reaches it from
this computer only through the system proxy on `127.0.0.1:7890`. AgentHerd's own model requests did
not use it: every request timed out after about 10 seconds and the owner saw `Request timed out.`
in 模型 → 测试. DeepSeek (in China) worked, so the app looked half broken.

Why the existing proxy code (ADR 0058) does not cover it:

- `packages/host/src/proxy.ts` writes `HTTPS_PROXY`/`HTTP_PROXY` into `process.env` **after the
  process is up** (`runHost`, the CLI commands). Node reads `NODE_USE_ENV_PROXY` only while it
  starts, so for Node 22 — the CLI, and any Node the app finds — the write is too late for the
  app's own `fetch`.
- The proxy in the environment is for the programs AgentHerd starts (`gh`, agents), which inherit
  it at their own start; the host itself had no equivalent.
- Measured on this computer, same gateway, before the change: no proxy variables → 10.7 s timeout;
  `HTTPS_PROXY` alone → 10.7 s; `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1` set *before* Node starts →
  1.4 s 401; set after start → still fine through a dead proxy, i.e. ignored.
- Electron 44 runs the host as Node 24, where `NODE_USE_ENV_PROXY` works at start, but the CLI
  runs on the owner's Node 22.19, where neither the variable nor `--use-env-proxy` exists. A fix
  that only writes the environment before `utilityProcess.fork` would leave the CLI broken, so
  the proxy is attached to the requests instead.

## Decision

1. **The proxy travels with the request.** `packages/herder/src/model-fetch.ts` exports
   `modelFetch()`: a `fetch` built once on first use from `process.env`, backed by undici's
   `EnvHttpProxyAgent`. `EnvHttpProxyAgent` is used rather than `ProxyAgent` because it reads
   `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` itself. With no proxy in the environment it returns the
   plain global `fetch`, so nothing changes for an owner without one.
2. **Every model request uses it:** the Herder's and its tasks' streams
   (`loginStream` in `packages/herder/src/logins.ts`), 模型 → 测试 (`testModel` in
   `packages/herder/src/models.ts`), and the model list of a custom service
   (`probeModels` in `packages/host/src/probe.ts`).
3. **Domestic services and this computer stay direct.** `NO_PROXY_DEFAULT`
   (`packages/host/src/proxy.ts`) is `localhost,127.0.0.1,::1,[::1],api.deepseek.com`, used when the
   environment has no `NO_PROXY`, and `modelFetch` always adds the loopback names, so a model
   served by Ollama or LM Studio on this machine is never sent to the proxy. A `NO_PROXY` the
   owner set is kept as it is.
4. **undici as a direct dependency of `@agentherd/herder`** (7.30.1, the version pi-ai's OpenAI
   SDK already resolves). It is the only way to reach `EnvHttpProxyAgent` from our code; Node 22
   does not expose its bundled copy.
5. Agent subprocesses are unchanged: they inherit the whole environment and already have the
   proxy at their own start.

## Consequences

- The owner restarts the app and 模型 → 测试 reaches the gateway; a wrong key answers 401 instead
  of a timeout, which is what "the connection works" looks like without a real key.
- A model request that would be direct can be checked by pointing the environment at a dead proxy
  (`HTTPS_PROXY=http://127.0.0.1:9`): with `api.deepseek.com` in `NO_PROXY` it still answers 401
  from DeepSeek, without it the request fails at the proxy.
- The dispatcher is built once. Changing the system proxy needs an app restart, as it already did
  for the child programs.
- Only model requests are routed. Other requests of the host (`gh` excepted, which gets the
  environment) still go direct; if one of them is blocked abroad, it needs this treatment too.
