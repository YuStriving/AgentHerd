import { type ModelService, modelLoginAccount, type SecretStore } from "@agentherd/core";
import { describe, expect, it, vi } from "vitest";
import { codexCanRun } from "../src/agent-models.ts";
import {
  LOGIN_FIELD,
  loginOf,
  loginStream,
  loginsFor,
  SecretCredentials,
  subscriptionProviders,
  withAuth,
} from "../src/logins.ts";
import { resolveModel, serviceKey, serviceReady } from "../src/models.ts";

function memorySecrets(): SecretStore & { saved: Record<string, string> } {
  const saved: Record<string, string> = {};
  return {
    saved,
    get: (a) => saved[a],
    set: (a, v) => {
      saved[a] = v;
    },
    delete: (a) => {
      delete saved[a];
    },
  };
}

const chatgpt: ModelService = {
  id: "chatgpt",
  name: "ChatGPT",
  kind: "builtin",
  provider: "openai-codex",
  auth: "subscription",
  models: ["gpt-6-astra"],
};

function signIn(secrets: SecretStore, expires = Date.now() + 3_600_000): void {
  secrets.set(
    modelLoginAccount("chatgpt"),
    JSON.stringify({ type: "oauth", access: "short-token", refresh: "long-token", expires }),
  );
}

describe("model subscriptions (ADR 0068)", () => {
  it("lists every vendor pi-ai signs in to", () => {
    const ids = subscriptionProviders().map((p) => p.provider);
    expect(ids).toEqual(
      expect.arrayContaining(["openai-codex", "anthropic", "github-copilot", "kimi-coding"]),
    );
  });

  it("marks subscription models, which run in Pi rather than Codex and need no key", () => {
    const secrets = memorySecrets();
    const model = resolveModel(chatgpt, "gpt-6-astra");
    expect(loginOf(model)).toBe("chatgpt");
    expect((model as unknown as Record<string, unknown>)[LOGIN_FIELD]).toBe("chatgpt");
    expect(codexCanRun(model)).toBe(false);
    expect(serviceKey(chatgpt, secrets)).toBeUndefined();
    expect(serviceReady(chatgpt, secrets)).toBe(false);
    signIn(secrets);
    expect(serviceReady(chatgpt, secrets)).toBe(true);
  });

  it("hands out the short token, never the refresh token", async () => {
    const secrets = memorySecrets();
    signIn(secrets);
    const auth = await loginsFor(secrets).auth(chatgpt);
    expect(auth.apiKey).toBe("short-token");
    expect(JSON.stringify(auth)).not.toContain("long-token");
    loginsFor(secrets).logout("chatgpt");
    await expect(loginsFor(secrets).auth(chatgpt)).rejects.toThrow(/not signed in/);
  });

  it("stores changes one at a time", async () => {
    const secrets = memorySecrets();
    const store = new SecretCredentials(secrets, "s");
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        store.modify("p", async (current) => {
          order.push(n);
          await new Promise((r) => setTimeout(r, 5 - n));
          const prev = (current as { access?: string } | undefined)?.access ?? "";
          return { type: "oauth", access: `${prev}${n}`, refresh: "r", expires: 1 };
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
    expect(JSON.parse(secrets.saved[modelLoginAccount("s")] ?? "{}").access).toBe("123");
    await store.modify("p", async () => undefined);
    expect(secrets.saved[modelLoginAccount("s")]).toBeUndefined();
  });

  it("applies a token given as a Bearer header and the account's own address", () => {
    const model = resolveModel(chatgpt, "gpt-6-astra");
    const out = withAuth(
      model,
      { apiKey: "old" },
      {
        headers: { Authorization: "Bearer tok" },
        baseUrl: "https://account.example",
      },
    );
    expect(out.options.apiKey).toBe("tok");
    expect(out.options.headers).toEqual({ Authorization: "Bearer tok" });
    expect(out.model.baseUrl).toBe("https://account.example");
  });

  it("returns a model error when proxy initialization fails", async () => {
    vi.stubEnv("https_proxy", "not-a-url");
    try {
      const stream = await loginStream(memorySecrets(), () => [chatgpt])(
        resolveModel(chatgpt, "gpt-6-astra"),
        { messages: [] },
      );
      expect(await stream.result()).toMatchObject({
        stopReason: "error",
        errorMessage: "Invalid model proxy configuration. Check HTTP_PROXY and HTTPS_PROXY.",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails the request as a model error when the service is not signed in", async () => {
    const secrets = memorySecrets();
    const stream = await loginStream(secrets, () => [chatgpt])(
      resolveModel(chatgpt, "gpt-6-astra"),
      { messages: [] },
    );
    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toMatch(/sign-in of "chatgpt" failed: .*not signed in/);
  });
});
