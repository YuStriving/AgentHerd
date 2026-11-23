import type { HerderRequestRecord } from "@agentherd/core";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
  streamSimple,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { measureContext } from "../src/context.ts";
import { Herder } from "../src/herder.ts";
import { fakeHost } from "./helpers.ts";

let faux: FauxProviderRegistration[] = [];
afterEach(() => {
  for (const f of faux) f.unregister();
  faux = [];
});

describe("what the Herder's requests are made of (ADR 0093)", () => {
  it("splits a request into the system prompt, memory, tools, the owner, the Herder, results and folds", () => {
    const snapshot = measureContext(
      [
        {
          role: "system",
          content:
            "你是主管。[记忆 · 主人画像] 是主人的画像卡。\n\n[记忆 · 主人画像 — 用量 5/600 字]\n- 称呼：火哥",
          toolsAdded: [{ name: "session_list", description: "列出任务", parameters: {} }],
        } as never,
        {
          role: "user",
          content: [{ type: "text", text: "[Compressed conversation section] — 搜索\n- 定了" }],
          timestamp: 0,
        } as never,
        {
          role: "user",
          content: [{ type: "text", text: "[Owner's message]\n现在什么情况？" }],
          timestamp: 5,
        } as never,
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "session_list", arguments: {} }],
          timestamp: 6,
        } as never,
        {
          role: "toolResult",
          toolName: "session_list",
          toolCallId: "c1",
          content: [{ type: "text", text: "没有任务" }],
          timestamp: 7,
        } as never,
        {
          role: "assistant",
          content: [{ type: "text", text: "现在没有任务在跑" }],
          timestamp: 8,
        } as never,
      ],
      128_000,
      new Date("2026-11-21T06:00:00.000Z"),
    );
    expect(snapshot.window).toBe(128_000);
    expect(snapshot.foldAt).toBe(115_200);
    expect(snapshot.at).toBe("2026-11-21T06:00:00.000Z");
    for (const p of ["system", "memory", "tools", "folds", "owner", "herder", "results"] as const)
      expect(snapshot.parts[p]).toBeGreaterThan(0);
    expect(snapshot.tokens).toBe(Object.values(snapshot.parts).reduce((a, b) => a + b, 0));
    const labels = snapshot.items.map((i) => [i.part, i.label]);
    expect(labels).toContainEqual(["tools", "session_list"]);
    expect(labels).toContainEqual(["herder", "调用 session_list"]);
    expect(labels).toContainEqual(["herder", "现在没有任务在跑"]);
    expect(labels).toContainEqual(["results", "session_list"]);
    expect(snapshot.items.find((i) => i.part === "memory")?.text).toContain("称呼：火哥");
    expect(snapshot.items.find((i) => i.part === "system")?.text).not.toContain("称呼");
    expect(snapshot.items.find((i) => i.part === "system")?.text).toContain("是主人的画像卡");
  });

  it("counts a turn's memory as memory, apart from the owner's words (ADR 0101)", () => {
    const snapshot = measureContext(
      [
        { role: "system", content: "你是主管。" } as never,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "[Owner's message]\n小王那边呢\n\n[记忆召回 · 只在这一轮带着；仅供参考]\n主人画像：\n- 称呼：火哥",
            },
          ],
          timestamp: 5,
        } as never,
      ],
      128_000,
    );
    const owner = snapshot.items.find((i) => i.part === "owner");
    const memory = snapshot.items.find((i) => i.part === "memory");
    expect(owner?.text).toBe("[Owner's message]\n小王那边呢");
    expect(memory?.label).toBe("这一轮的记忆");
    expect(memory?.text).toMatch(/^\[记忆召回 · [\s\S]*称呼：火哥$/);
  });

  it("counts a compress call and its receipt as a fold, since the model reads the summary there (ADR 0096)", () => {
    const summary = "m00002–m00040 三月发票\n- 发票都整理好了，存在 ~/发票/三月";
    const snapshot = measureContext(
      [
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "k1", name: "compress", arguments: { content: summary } },
          ],
          timestamp: 6,
        } as never,
        {
          role: "toolResult",
          toolName: "compress",
          toolCallId: "k1",
          content: [{ type: "text", text: "Compressed 1 block(s), about 9000 tokens folded." }],
          timestamp: 7,
        } as never,
      ],
      128_000,
    );
    expect(snapshot.parts.herder).toBe(0);
    expect(snapshot.parts.results).toBe(0);
    expect(snapshot.parts.folds).toBe(snapshot.tokens);
    expect(snapshot.items.map((i) => [i.part, i.label])).toEqual([
      ["folds", "m00002–m00040 三月发票"],
      ["folds", "折叠回执"],
    ]);
  });

  it("keeps the numbers the model counted for each request, with what was sent", async () => {
    const registration = registerFauxProvider();
    faux.push(registration);
    const { host } = fakeHost();
    const records: HerderRequestRecord[] = [];
    host.recordRequest = (r) => void records.push(r);
    const herder = new Herder({
      host,
      model: registration.getModel(),
      streamFn: streamSimple,
      sleep: async () => {},
    });
    registration.setResponses([
      fauxAssistantMessage([fauxToolCall("session_list", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage("现在没有任务在跑"),
    ]);
    herder.ownerMessage("现在什么情况？");
    await herder.idle();

    expect(records).toHaveLength(2);
    expect(records[0]?.model).toContain("/");
    expect(records[0]?.input).toBeGreaterThan(0);
    expect(records[1]?.tokens).toBeGreaterThan(records[0]?.tokens ?? 0);
    expect(records[1]?.parts?.results).toBeGreaterThan(0);
    expect(records.map((r) => r.round)).toEqual([0, 0]);
    expect(records.map((r) => r.seq)).toEqual([1, 3]);
  });
});
