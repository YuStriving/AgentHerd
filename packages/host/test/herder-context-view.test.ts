// The 上下文 tab read from herd.db alone (ADR 0095): the next request rebuilt, folds placed in the
// model's order, rounds, requests by day, messages and a fold's originals.

import { Store } from "@agentherd/core";
import { CONTEXT_STATE_KEY, HerderContext, promptMessage } from "@agentherd/herder";
import { describe, expect, it } from "vitest";
import {
  foldText,
  herderContextView,
  herderMessages,
  MESSAGE_TEXT_MAX,
  messageText,
  usageFrom,
} from "../src/herder-context-view.ts";

type Message = ConstructorParameters<typeof HerderContext>[1][number];

const usage = (input: number, cacheRead: number, total = 0) => ({
  input,
  output: 10,
  cacheRead,
  cacheWrite: 0,
  totalTokens: input + cacheRead + 10,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});

const owner = (text: string, at: number): Message =>
  ({
    role: "user",
    content: [{ type: "text", text: `[Owner's message]\n${text}` }],
    timestamp: at,
  }) as Message;

const reply = (text: string, at: number, u = usage(100, 900, 0.001)): Message =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "faux",
    provider: "deepseek",
    model: "deepseek-flash",
    usage: u,
    stopReason: "stop",
    timestamp: at,
  }) as Message;

const call = (id: string, name: string, args: Record<string, unknown>, at: number): Message =>
  ({
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: args }],
    api: "faux",
    provider: "deepseek",
    model: "deepseek-flash",
    usage: usage(50, 950),
    stopReason: "toolUse",
    timestamp: at,
  }) as Message;

const result = (id: string, name: string, text: string, at: number): Message =>
  ({
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: at,
  }) as Message;

const T0 = Date.parse("2026-11-20T02:00:00Z");
const DAY = 86_400_000;
const SUMMARY =
  "主人让我整理三月的发票，附了一大段材料。我整理好了并回复了主人，这件事已经办完，没有要跟进的，也没有提到项目目录或模型。";

/** Three rounds; in the third the Herder folds the first with compress. */
async function folded() {
  const log: Message[] = [
    owner(`整理三月的发票 ${"甲".repeat(6000)}`, T0),
    reply("发票整理好了。", T0 + 1000),
    owner(`第二件事 ${"乙".repeat(6000)}`, T0 + DAY),
    reply("第二件也好了。", T0 + DAY + 1000),
    owner("把发票那段收起来", T0 + DAY + 1500),
  ];
  const system = { role: "system", content: "rules", timestamp: 0 } as Message;
  const messages = () => [system, ...log];
  const context = new HerderContext(
    { contextWindow: () => 128_000, messages, audit: () => {} },
    log,
  );
  context.project(messages());
  const args = { content: `m00002–m00003 三月发票\n${SUMMARY}` };
  log.push(call("k1", "compress", args, T0 + DAY + 2000));
  const tool = context.tools().find((t) => t.name === "compress");
  const done = await tool?.execute("k1", args);
  const text = ((done?.content ?? []) as { text: string }[])[0]?.text ?? "";
  log.push(result("k1", "compress", text, T0 + DAY + 2500));
  log.push(reply("收好了。", T0 + DAY + 3000));
  context.project(messages());

  const store = Store.open(":memory:");
  store.writeHerderLog(0, log);
  store.saveHerderContext(CONTEXT_STATE_KEY, context.bookkeeping(), context.changedFolds(log));
  store.putHerderPrompt({ hash: "p1", system: "rules", tools: [], tokens: 5 });
  let round = 0;
  for (const [seq, m] of log.entries()) {
    if (m.role === "user") round = seq;
    if (m.role !== "assistant") continue;
    const u = (m as { usage: ReturnType<typeof usage> }).usage;
    store.addHerderRequest({
      at: new Date(m.timestamp).toISOString(),
      seq,
      round,
      model: "deepseek/deepseek-flash",
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
      cost: u.cost.total,
      tokens: u.input + u.cacheRead,
      window: 128_000,
    });
  }
  return { store, log };
}

describe("the 上下文 tab from herd.db (ADR 0095)", () => {
  it("rebuilds the next request and places the fold where the model reads it", async () => {
    const { store, log } = await folded();
    const view = herderContextView(store, false, "k");
    expect(view.problem).toBeUndefined();
    expect(view.on).toBe(false);
    expect(view.now?.noPrompt).toBeUndefined();
    expect(view.now?.window).toBe(128_000);
    expect(view.now?.foldAt).toBe(115_200);
    // The folded 6,000 characters are gone from what goes out; the summary is there.
    expect(view.now?.tokens).toBeLessThan(view.facts.tokens);
    expect(view.now?.parts.system).toBeGreaterThan(0);
    expect(view.now?.items.some((i) => i.text.includes("甲甲甲"))).toBe(false);

    expect(view.facts).toMatchObject({
      messages: log.length,
      rounds: 3,
      activeFolds: 1,
      folds: 1,
      shown: log.length - 2,
    });
    expect(view.facts.saved).toBeGreaterThan(5000);
    expect(view.segments.map((s) => [s.kind, s.startSeq, s.endSeq])).toEqual([
      ["fold", 0, 1],
      ["raw", 2, 7],
    ]);

    const [fold] = view.folds;
    expect(fold).toMatchObject({
      blockId: "b1",
      children: [],
      level: 1,
      state: "active",
      by: "herder",
      summary: SUMMARY,
      startSeq: 0,
      endSeq: 1,
      messages: 2,
      rounds: 1,
      kinds: { owner: 1, reply: 1 },
      callSeq: 5,
      summaryAt: "call",
      startAt: new Date(T0).toISOString(),
    });
    expect(fold?.pending).toBeUndefined();

    expect(view.rounds.map((r) => [r.seq, r.endSeq, r.kind, r.messages, r.fold])).toEqual([
      [0, 1, "owner", 2, "b1"],
      [2, 3, "owner", 2, undefined],
      [4, 7, "owner", 4, undefined],
    ]);
    expect(view.rounds[0]?.title).toContain("整理三月的发票");
  });

  it("adds up token use per day with the cache hits and the cost", async () => {
    const { store } = await folded();
    const view = herderContextView(store, true, "k");
    expect(view.requests.map((r) => [r.seq, r.round, r.input, r.cacheRead])).toEqual([
      [1, 0, 100, 900],
      [3, 2, 100, 900],
      [5, 4, 50, 950],
      [7, 4, 100, 900],
    ]);
    expect(view.days.map((d) => [d.day.length, d.requests])).toEqual([
      [10, 1],
      [10, 3],
    ]);
    expect(view.total).toMatchObject({ requests: 4, input: 350, cacheRead: 3650, output: 40 });
    expect(view.total.cost).toBeCloseTo(0.003);
    expect(view.total.hitRate).toBeCloseTo(3650 / 4000);
    expect(view.facts.lastHitRate).toBeCloseTo(0.9);
    expect(
      usageFrom({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
    ).toMatchObject({ hitRate: 0 });
  });

  it("says when no system prompt is kept yet, and still shows the conversation", async () => {
    const { store } = await folded();
    const bare = Store.open(":memory:");
    bare.writeHerderLog(0, store.herderLog());
    const view = herderContextView(bare, false, "k");
    expect(view.now?.noPrompt).toBe(true);
    expect(view.now?.parts.system).toBe(0);
    // Without the fold rows the fold is replayed from the compress call in the log.
    expect(view.segments[0]).toMatchObject({ kind: "fold", blockId: "b1" });
  });

  it("gives messages a few at a time and a fold's originals", async () => {
    const { store } = await folded();
    const page = herderMessages(store, 3, 5);
    expect(page.map((m) => [m.seq, m.role, m.kind, m.tool])).toEqual([
      [3, "assistant", "reply", undefined],
      [4, "user", "owner", undefined],
      [5, "assistant", "call", "compress"],
    ]);
    expect(page[2]?.text).toContain("compress(");
    const long = herderMessages(store, 0, 0)[0];
    expect(long?.text).toHaveLength(MESSAGE_TEXT_MAX);
    expect(long?.more).toBeGreaterThan(4000);
    expect(herderMessages(store, 0, 10_000)).toHaveLength(8);

    const originals = foldText(store, "b1");
    expect(originals).toContain("#0 进来的");
    expect(originals).toContain("甲甲甲");
    expect(originals).toContain("#1 主管\n发票整理好了。");
    expect(() => foldText(store, "b9")).toThrow("no fold b9");
    expect(messageText(promptMessage({ system: "rules", tools: [] }))).toBe("rules");
  });
});
