import { describe, expect, it } from "vitest";
import { sampleHerderContext } from "../src/renderer/src/dev-fixtures.ts";
import {
  CONTEXT_PARTS,
  contextRecords,
  contextTree,
  dollars,
  drawnTree,
  foldMarks,
  formatTokens,
  itemsOf,
  kindsLine,
  mapLayout,
  messageLine,
  PART_LABELS,
  partsBySize,
  percent,
  spanOf,
  summaryWhere,
  timeOf,
} from "../src/renderer/src/herder-context.ts";

describe("the 上下文 tab (ADR 0093)", () => {
  it("names every part the host measures", () => {
    expect([...CONTEXT_PARTS].sort()).toEqual([
      "folds",
      "herder",
      "memory",
      "owner",
      "results",
      "system",
      "tools",
    ]);
    for (const p of CONTEXT_PARTS) expect(PART_LABELS[p]).not.toBe("");
  });

  it("writes token counts, shares and dollars short", () => {
    expect(formatTokens(812)).toBe("812");
    expect(formatTokens(19_400)).toBe("19.4k");
    expect(formatTokens(128_000)).toBe("128k");
    expect(formatTokens(1_480_000)).toBe("1.48M");
    expect(percent(0, 0)).toBe("0%");
    expect(percent(57, 128)).toBe("45%");
    expect(percent(9, 1000)).toBe("0.9%");
    expect(percent(1, 100_000)).toBe("<0.1%");
    expect(dollars(0)).toBe("$0");
    expect(dollars(0.004)).toBe("<$0.01");
    expect(dollars(0.441)).toBe("$0.44");
  });

  it("lists parts and items largest first", () => {
    const now = sampleHerderContext().now;
    if (now === undefined) throw new Error("no now");
    const order = partsBySize(now.parts);
    expect(order[0]).toBe("results");
    expect(order.every((p, i) => i === 0 || now.parts[order[i - 1] ?? p] >= now.parts[p])).toBe(
      true,
    );
    expect(itemsOf(now, "tools").map((i) => i.label)).toEqual([
      "session_start",
      "web_search",
      "memory",
    ]);
  });

  it("shows the time alone today and the date before, and spans short", () => {
    const now = new Date(2026, 10, 21, 15, 0);
    expect(timeOf(new Date(2026, 10, 21, 9, 5).toISOString(), now)).toBe("09:05");
    expect(timeOf(new Date(2026, 10, 19, 23, 40).toISOString(), now)).toBe("11-19 23:40");
    const a = new Date(2026, 10, 19, 21, 31).toISOString();
    const b = new Date(2026, 10, 19, 23, 2).toISOString();
    const c = new Date(2026, 10, 20, 12, 16).toISOString();
    expect(spanOf(a, b)).toBe("11-19 21:31 → 23:02");
    expect(spanOf(a, c)).toBe("11-19 21:31 → 11-20 12:16");
    expect(spanOf(a, a)).toBe("11-19 21:31");
  });
});

describe("folds, the map and the tree (ADR 0095)", () => {
  it("draws both bars on one scale, with the folds much smaller below", () => {
    const view = sampleHerderContext();
    const map = mapLayout(view);
    expect(map.top.map((b) => b.key)).toEqual(["b4", "b3", "raw:191"]);
    expect(map.bottom.map((b) => b.key)).toEqual([
      "part:system",
      "part:tools",
      "part:memory",
      "b4",
      "b3",
      "raw:191",
    ]);
    const top = new Map(map.top.map((b) => [b.key, b]));
    const bottom = new Map(map.bottom.map((b) => [b.key, b]));
    expect(bottom.get("b4")?.w).toBeLessThan((top.get("b4")?.w ?? 0) / 10);
    // A stretch the model reads as it was is the same width in both bars.
    expect(bottom.get("raw:191")?.w).toBeCloseTo(top.get("raw:191")?.w ?? 0);
    const last = map.top.at(-1);
    expect((last?.x ?? 0) + (last?.w ?? 0)).toBeCloseTo(1, 2);
  });

  it("builds the tree in reading order, folds holding the folds they took in", () => {
    const view = sampleHerderContext();
    const tree = contextTree(view);
    expect(tree.map((n) => n.id)).toEqual([
      "part:system",
      "part:tools",
      "part:memory",
      "fold:b4",
      "fold:b3",
      "raw:191",
    ]);
    const b4 = tree.find((n) => n.id === "fold:b4");
    expect(b4?.children.map((c) => c.id)).toEqual(["fold:b1", "fold:b2"]);
    expect(b4?.children[0]?.children.every((c) => c.kind === "round")).toBe(true);
    expect(b4?.meta).toContain("第 2 层");
    const raw = tree.at(-1);
    expect(raw?.title).toBe("原文 #191–#299");
    expect(raw?.children.length).toBeGreaterThan(20);

    const drawn = drawnTree(tree);
    const at = new Map(drawn.nodes.map((n) => [n.id, n]));
    expect(drawn.depth).toBe(2);
    expect(at.get("fold:b1")?.depth).toBe(2);
    expect(at.get("fold:b4")?.row).toBeCloseTo(
      ((at.get("fold:b1")?.row ?? 0) + (at.get("fold:b2")?.row ?? 0)) / 2,
    );
    expect(drawn.links).toContainEqual({ from: "fold:b4", to: "fold:b2" });
    expect(drawn.links).toContainEqual({ from: "request", to: "raw:191" });
  });

  it("says where the model reads a summary and what a fold holds", () => {
    const view = sampleHerderContext();
    const byId = new Map(view.folds.map((f) => [f.blockId, f]));
    const b4 = byId.get("b4");
    const b1 = byId.get("b1");
    if (b4 === undefined || b1 === undefined) throw new Error("no folds");
    expect(summaryWhere(b4)).toBe("摘要写在 #212 那次 compress 调用里，模型在那个位置读到它");
    expect(summaryWhere(b1)).toBe("已经并进 b4，模型只读 b4 的摘要");
    expect(kindsLine({ owner: 2, result: 1, call: 1, task: 1 })).toBe(
      "你的话 2、任务结果 1、工具调用 1、工具结果 1",
    );
  });

  it("puts ✂ marks at the first request after each fold and lists records newest first", () => {
    const view = sampleHerderContext();
    const marks = foldMarks(view.requests, view.folds);
    expect(marks.map((m) => m.blockId)).toEqual(["b1", "b2", "b4", "b3"]);
    for (const m of marks) {
      const f = view.folds.find((x) => x.blockId === m.blockId);
      expect(view.requests[m.index]?.at >= (f?.createdAt ?? "")).toBe(true);
    }
    const records = contextRecords(view.folds, view.events);
    expect(records[0]?.title).toBe("主管启动");
    expect(records.some((r) => r.title === "修正了 b3 的范围")).toBe(true);
    expect(records.find((r) => r.blockId === "b2")?.title).toBe("快满了，自动折了 b2");
    expect(records.find((r) => r.blockId === "b1")?.text).toContain("后来并进 b4");
  });

  it("writes a message's line without the time and label lines", () => {
    expect(
      messageLine({
        role: "user",
        kind: "owner",
        text: "[Now: 2026-11-20 14:02, Friday]\n[Owner's message]\n看看今天腾讯和快手",
      }),
    ).toBe("看看今天腾讯和快手");
    expect(messageLine({ role: "assistant", kind: "call", tool: "web_search", text: "x" })).toBe(
      "调用 web_search",
    );
    expect(messageLine({ role: "toolResult", kind: "result", tool: "web_read", text: "abc" })).toBe(
      "web_read 返回 3 字",
    );
  });
});
