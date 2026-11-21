// The Herder's context over the forked kernel (ADR 0045): refs, folds the model writes, the forced
// fold, overflow, restarts and the fallback when the engine fails.

import { type CompressionState, defaultCountTokens } from "@agentherd/context-kernel";
import { countTokens, type HerderFoldRecord } from "@agentherd/core";
import type { AgentMessage } from "@agentherd/herder-loop";
import { describe, expect, it } from "vitest";
import { HerderContext, promptOf, withoutContextMarks } from "../src/context.ts";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const SYSTEM = { role: "system", content: "rules", timestamp: 0 } as AgentMessage;

const owner = (text: string): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text: `[Owner's message]\n${text}` }],
  timestamp: 1,
});

const assistant = (content: unknown[], stopReason = "stop"): AgentMessage =>
  ({
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage,
    stopReason,
    timestamp: 1,
  }) as AgentMessage;

const reply = (text: string) => assistant([{ type: "text", text }]);

const call = (id: string, name: string, args: Record<string, unknown>, text?: string) =>
  assistant(
    [
      ...(text === undefined ? [] : [{ type: "text", text }]),
      { type: "toolCall", id, name, arguments: args },
    ],
    "toolUse",
  );

const result = (id: string, name: string, text: string): AgentMessage =>
  ({
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1,
  }) as AgentMessage;

/** The text parts of a message or tool result, joined. */
function textOf(m: { content?: unknown } | undefined): string {
  const content = m?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } => (c as { type: string }).type === "text")
    .map((c) => c.text)
    .join("\n");
}

function setup(
  log: AgentMessage[],
  opts: { window?: number; saved?: CompressionState; folds?: HerderFoldRecord[] } = {},
) {
  const audits: { type: string; data: Record<string, unknown> }[] = [];
  const events: { kind: string; data: Record<string, unknown> }[] = [];
  const box = { messages: [SYSTEM, ...log] };
  const context = new HerderContext(
    {
      contextWindow: () => opts.window ?? 128_000,
      messages: () => box.messages,
      audit: (type, data) => void audits.push({ type, data }),
      event: (kind, data) => void events.push({ kind, data }),
    },
    log,
    opts.saved,
    opts.folds,
  );
  return { context, box, audits, events, project: () => context.project(box.messages) };
}

const tool = (context: HerderContext, name: string) => {
  const found = context.tools().find((t) => t.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};

const INVOICES = "甲".repeat(6000);
const SUMMARY =
  "主人让我整理三月的发票，附了一大段材料。我整理好了并回复了主人，这件事已经办完，没有要跟进的，也没有提到项目目录或模型。";

/** Two big owner turns, then the model folds the first one with compress. */
async function folded() {
  const s = setup([
    owner(`整理三月的发票 ${INVOICES}`),
    reply("发票整理好了。"),
    owner(`第二件事 ${"乙".repeat(6000)}`),
    reply("第二件也好了。"),
    owner("把发票那段收起来"),
  ]);
  s.project();
  const args = { content: `m00002–m00003 三月发票\n${SUMMARY}` };
  s.box.messages.push(call("k1", "compress", args));
  const done = await tool(s.context, "compress").execute("k1", args);
  s.box.messages.push(result("k1", "compress", textOf(done)));
  return { ...s, done };
}

describe("HerderContext", () => {
  it("shows every message with its ref and leaves tool calls as they were", () => {
    const log = [
      owner("看看任务"),
      call("c1", "session_list", {}, "我看一下"),
      result("c1", "session_list", "Open tasks: none"),
      reply("现在没有任务。"),
    ];
    const out = setup(log).project();
    expect(out[0]).toBe(SYSTEM);
    expect(textOf(out[1])).toMatch(
      /^<acp tokens="\d+" type="text">m00001<\/acp>\n\[Start of the conversation with the owner\./,
    );
    expect(textOf(out[2])).toMatch(/^<acp [^>]*>m00002<\/acp>\n\[Owner's message\]\n看看任务$/);
    const asked = out[3] as Extract<AgentMessage, { role: "assistant" }>;
    expect(textOf(asked)).toBe("我看一下"); // the Herder's own words carry no tag

    expect(asked.content[1]).toBe(
      (log[1] as Extract<AgentMessage, { role: "assistant" }>).content[1],
    );
    expect(textOf(out[4])).toMatch(/^<acp [^>]*>m00005<\/acp>\nOpen tasks: none$/);
    expect(textOf(out[5])).toBe("现在没有任务。");
    expect(out).toHaveLength(6);
    expect(textOf(log[0])).toBe("[Owner's message]\n看看任务");
  });

  it("the model folds a finished part with compress; search_context and decompress bring it back", async () => {
    const { context, project, done, audits } = await folded();
    expect(textOf(done)).toContain("Compressed 1 block(s)");
    expect(audits.map((a) => a.type)).toEqual(["herder.context.compress"]);
    const sent = JSON.stringify(project());
    expect(sent).not.toContain("甲甲甲");
    expect(sent).toContain(SUMMARY);
    expect(sent).toContain("乙乙乙");

    const found = textOf(await tool(context, "search_context").execute("s1", { query: "发票" }));
    expect(found).toContain("b1");
    const shown = textOf(await tool(context, "decompress").execute("d1", { blockId: "b1" }));
    expect(shown).toContain("甲甲甲");
    expect(shown).toContain("It stays folded");
    expect(JSON.stringify(project())).not.toContain("甲甲甲");

    const status = textOf(await tool(context, "acp_status").execute("a1", {}));
    expect(status).toMatch(/^Context: about \d+ of 128000 tokens \(\d+%\), 1 active block\(s\)\./);
  });

  it("refuses a fold without ranges and says how to write one", async () => {
    const { context } = setup([owner("你好"), reply("你好。")]);
    await expect(tool(context, "compress").execute("k1", { content: "收起来" })).rejects.toThrow(
      /no ranges found/,
    );
  });

  it("works in at most 128,000 tokens even when the model reads more", async () => {
    const { context } = setup([owner("你好"), reply("你好。")], { window: 1_000_000 });
    const status = textOf(await tool(context, "acp_status").execute("a1", {}));
    expect(status).toMatch(/ of 128000 tokens /);
  });

  it("folding what is already folded is a receipt, not an error, so the model does not retry", async () => {
    const s = await folded();
    const args = { content: `m00002–m00003 三月发票\n${SUMMARY}` };
    s.box.messages.push(call("k2", "compress", args));
    const again = textOf(await tool(s.context, "compress").execute("k2", args));
    expect(again).toMatch(/^\[Compression no-op: nothing in these ranges needed folding\./);
  });

  it("a fold is kept across a restart: from the saved state, or replayed from the log", async () => {
    const before = await folded();
    const log = before.box.messages.slice(1);
    for (const saved of [structuredClone(before.context.state), undefined]) {
      const after = setup(log, saved === undefined ? {} : { saved });
      const sent = JSON.stringify(after.project());
      expect(sent).not.toContain("甲甲甲");
      expect(sent).toContain(SUMMARY);
      expect(after.audits).toEqual([]);
    }
  });

  it("folds old turns itself when the context is nearly full, keeping the current turn", () => {
    const log: AgentMessage[] = [];
    for (let i = 0; i < 8; i++)
      log.push(owner(`第${i}件事 ${"字".repeat(2500)}`), reply(`第${i}件办好了`));
    log.push(owner("现在呢"));
    const s = setup(log, { window: 20_000 });
    const out = s.project();
    expect(s.audits.map((a) => a.type)).toContain("herder.context.forced-fold");
    const sent = JSON.stringify(out);
    expect(sent).not.toContain(`第0件事 ${"字".repeat(200)}`);
    expect(sent).toContain("Folded without a summary");
    expect(sent).toContain("第0件事 字字"); // the start of each owner message stays in the note
    expect(sent).toContain(`第7件事 ${"字".repeat(2500)}`);
    expect(sent).toContain("现在呢");
    expect(out.length).toBeLessThan(log.length);
  });

  it("after the provider said the request was too long, folds about half", () => {
    const log: AgentMessage[] = [];
    for (let i = 0; i < 6; i++)
      log.push(owner(`第${i}件事 ${"字".repeat(3000)}`), reply(`第${i}件办好了`));
    const s = setup(log);
    expect(s.context.foldForOverflow()).toBe(true);
    const sent = JSON.stringify(s.project());
    expect(sent).not.toContain(`第0件事 ${"字".repeat(200)}`);
    expect(sent).toContain(`第5件事 ${"字".repeat(3000)}`);
  });

  it("a message taken back with a failed turn does not keep its old size in the ref", () => {
    const first = owner("你好");
    const s = setup([first, owner("y".repeat(8000))]);
    expect(textOf(s.project()[3])).toMatch(/^<acp tokens="2\.0K" type="text">m00003<\/acp>\n/);
    s.context.rollback(1);
    s.box.messages = [SYSTEM, first, owner("好")];
    expect(textOf(s.project()[3])).toMatch(
      /^<acp tokens="\d" type="text">m00003<\/acp>\n\[Owner's message\]\n好$/,
    );
  });

  it("when the engine fails, the newest whole turns go out as they are", () => {
    const s = setup([owner("你好"), reply("你好。"), owner("在吗")]);
    s.context.state = { ...s.context.state, blocks: null } as unknown as CompressionState;
    const out = s.project();
    expect(out).toEqual(s.box.messages);
    expect(s.audits[0]).toMatchObject({
      type: "herder.context.error",
      data: { during: "project" },
    });
  });

  it("removes ref tags the model copied into its text", () => {
    expect(
      withoutContextMarks(
        '<acp tokens="3" type="text">m00005</acp>\n好的，<acp tokens="1.2K" type="session_list">m00007</acp>看过了',
      ),
    ).toBe("好的，看过了");
  });

  it("removes lines that begin like a tag but end otherwise", () => {
    expect(withoutContextMarks('<acp tokens="39" type="text">m00205</p>\n找到两个：\n- 甲')).toBe(
      "找到两个：\n- 甲",
    );
    expect(withoutContextMarks('  <acp tokens="39" text="text">m00195</p>\n好')).toBe("好");
    expect(withoutContextMarks("我用 <acp> 标签吗？")).toBe("我用 <acp> 标签吗？");
  });

  it("takes tags the model wrote itself out of its earlier replies", () => {
    const out = setup([
      owner("在吗"),
      reply('<acp tokens="39" type="text">m00205</p>\n在的'),
      owner("好"),
    ]).project();
    expect(textOf(out[3])).toBe("在的");
  });
});

describe("folds as rows of their own (ADR 0095)", () => {
  it("counts tokens the way the engine does", () => {
    for (const text of [
      "",
      "hello world",
      "主人让我整理三月的发票",
      "mixed 中文 and English，标点。",
    ])
      expect(countTokens(text)).toBe(defaultCountTokens(text));
  });

  it("keeps each fold as a row: who made it, what it covers, where its call is", async () => {
    const s = await folded();
    const log = s.box.messages.slice(1);
    const rows = s.context.changedFolds(log, new Date("2026-11-21T10:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      blockId: "b1",
      level: 1,
      state: "active",
      by: "herder",
      summary: SUMMARY,
      startSeq: 0,
      endSeq: 1,
      messages: 2,
      callSeq: 5,
      updatedAt: "2026-11-21T10:00:00.000Z",
    });
    expect(rows[0]?.tokensAfter).toBeLessThan(rows[0]?.tokensBefore ?? 0);
    // Saved once; nothing changed since.
    expect(s.context.changedFolds(log)).toEqual([]);
    expect(s.context.bookkeeping().blocks).toEqual([]);
    expect(s.events.map((e) => [e.kind, e.data.blockId, e.data.by])).toEqual([
      ["fold", "b1", "herder"],
    ]);

    // A restart from the bookkeeping and the rows alone shows the same.
    const after = setup(log, { saved: s.context.bookkeeping(), folds: rows });
    // Nothing to write back on start; each turn the engine ages its blocks, so rows change then.
    expect(after.context.changedFolds(log)).toEqual([]);
    expect(JSON.stringify(after.project())).toBe(JSON.stringify(s.project()));
  });

  it("refuses a range that cuts into a fold and says how to take it in or leave it", async () => {
    const s = await folded();
    s.box.messages.push(owner(`第三件 ${"丙".repeat(6000)}`), reply("好了"));
    s.project();
    const args = { content: `m00003–m00006 发票和第二件\n${SUMMARY}` };
    s.box.messages.push(call("k2", "compress", args));
    await expect(tool(s.context, "compress").execute("k2", args)).rejects.toThrow(
      "m00003–m00006 cuts into b1 (m00002–m00003). A fold takes in whole folds or none of one: start at m00002 or earlier",
    );
    expect(s.context.cutsIntoFold("m00002", "m00006")).toBeUndefined();
    expect(s.context.cutsIntoFold("m00004", "m00006")).toBeUndefined();
  });

  it("a fold made before the check that cut into an older one keeps only its own part, the view unchanged", async () => {
    const s = await folded();
    s.box.messages.push(owner(`第三件 ${"丙".repeat(6000)}`), reply("第三件好了"), owner("好"));
    s.project();
    const log = s.box.messages.slice(1);
    // Write the cut the old code allowed: b2 claims b1's last message as well.
    const b1 = s.context.state.blocks[0];
    if (b1 === undefined) throw new Error("no b1");
    const own = ["h7", "h8"];
    const b2 = {
      ...b1,
      blockId: "b2",
      runId: 2,
      topic: "第三件",
      summary: "第三件事办完了，没有要跟进的事，也没有提到项目目录、模型或者别的要记住的东西。",
      directMessageIds: own,
      effectiveMessageIds: ["h1", ...own],
      compressCallId: undefined,
      createdAt: b1.createdAt + 1000,
    };
    const cut = { ...s.context.state, blocks: [b1, b2] } as CompressionState;
    const old = setup(log);
    (old.context as unknown as { state: CompressionState }).state = structuredClone(cut);
    const fixed = setup(log, { saved: structuredClone(cut) });
    expect(fixed.context.repaired).toEqual(["b2"]);
    expect(fixed.context.state.blocks[1]?.effectiveMessageIds).toEqual(own);
    expect(JSON.stringify(fixed.project())).toBe(JSON.stringify(old.project()));
    expect(fixed.audits.map((a) => a.type)).toContain("herder.context.repaired");
    expect(fixed.events.map((e) => e.kind)).toEqual(["fold.repaired"]);
  });

  it("keeps the system prompt and tools under one hash", () => {
    const view = [
      { ...SYSTEM, toolsAdded: [{ name: "session_list" }] } as AgentMessage,
      owner("hi"),
    ];
    const a = promptOf(view);
    expect(a?.system).toBe("rules");
    expect(a?.tools).toEqual([{ name: "session_list" }]);
    expect(a?.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(promptOf([{ ...SYSTEM, content: "other" } as AgentMessage])?.hash).not.toBe(a?.hash);
    expect(promptOf([owner("no system")])).toBeUndefined();
  });
});
