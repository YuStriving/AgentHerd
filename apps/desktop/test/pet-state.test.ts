import type { PetCard, PetView, TasksView } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";
import {
  addDrops,
  badgeOf,
  CHAT_DEFAULT,
  CHAT_MIN,
  canStop,
  cardGroups,
  clockOf,
  conversationOf,
  cut,
  dragChat,
  elapsedOf,
  eventOf,
  FLASH_MS,
  FOLD_CHARS,
  fitChat,
  flashOf,
  foldBody,
  foldOf,
  GAP_MS,
  historyHead,
  modelName,
  moodOf,
  newestScroll,
  newLine,
  readChatSize,
  readTab,
  remainingSays,
  reportHead,
  runnerOf,
  SLEEP_AFTER_MS,
  separatorOf,
  statusOf,
  stepOf,
  suggestionFor,
  TASK_DOTS_MAX,
  TASKS_ENDED_MS,
  taskDots,
  taskGroups,
  trailingLine,
} from "../src/renderer/src/pet/pet-state";
import { ANIMATIONS, ATLAS, frameAt, HELLO_MS } from "../src/renderer/src/pet/sprite";
import { hitPetRegion } from "../src/shared/bridge";

const IDLE: PetView = { connected: true, pending: [] };
const NOW = 1_000_000;

describe("pet mood (ADR 0070)", () => {
  const base = { view: IDLE, working: 0, lastActive: NOW, now: NOW, online: true };

  it("waits while something waits for the owner, before anything else", () => {
    const view: PetView = {
      connected: true,
      pending: [{ target: "i1", title: "rm -rf ./*", body: "", options: [] }],
    };
    expect(
      moodOf({ ...base, view, working: 2, flash: { mood: "celebrate", until: NOW + 1 } }),
    ).toBe("waiting");
  });

  it("cheers or worries for a while after a task ends, then works or rests", () => {
    expect(moodOf({ ...base, flash: { mood: "celebrate", until: NOW + 1 } })).toBe("celebrate");
    expect(moodOf({ ...base, working: 1, flash: { mood: "error", until: NOW + 1 } })).toBe("error");
    expect(moodOf({ ...base, working: 1, flash: { mood: "error", until: NOW } })).toBe("working");
    expect(moodOf(base)).toBe("resting");
  });

  it("dozes off when nothing happens, and while the host is away", () => {
    expect(moodOf({ ...base, lastActive: NOW - SLEEP_AFTER_MS })).toBe("sleeping");
    expect(moodOf({ ...base, online: false })).toBe("sleeping");
    expect(moodOf({ ...base, working: 1, lastActive: NOW - SLEEP_AFTER_MS })).toBe("working");
  });

  it("flashes on reports and errors only", () => {
    const line = { id: 1, at: "", text: "x" };
    expect(flashOf({ ...line, kind: "report", result: "done" })).toBe("celebrate");
    expect(flashOf({ ...line, kind: "report", result: "failed" })).toBe("error");
    expect(flashOf({ ...line, kind: "error" })).toBe("error");
    expect(flashOf({ ...line, kind: "say" })).toBeUndefined();
    expect(FLASH_MS).toBeGreaterThan(0);
  });
});

describe("new lines open the conversation (ADR 0070)", () => {
  const at = "2026-11-18T03:44:18Z";

  it("takes the first look as history, then opens for every newer line", () => {
    const line = { id: 5, at, kind: "say" as const, text: "好" };
    expect(newLine(undefined, line)).toBe(false);
    expect(newLine(5, line)).toBe(false);
    expect(newLine(4, line)).toBe(true);
    expect(newLine(4, undefined)).toBe(false);
  });

  it("shows the latest line after the conversation when the conversation lacks it", () => {
    const history = [{ id: 1, at: "2026-11-18T03:40:00Z", kind: "say" as const, text: "在查了" }];
    const progress = { id: 9, at, kind: "task" as const, task: "搜面馆", text: "启动中" };
    expect(trailingLine(history, progress)).toBe(progress);
    // Already the newest message of the conversation, spaces aside.
    expect(trailingLine(history, { ...progress, text: "在查 了" })).toBeUndefined();
    // Older than the conversation's newest message, or a card of its own.
    expect(trailingLine(history, { ...progress, at: "2026-11-18T03:00:00Z" })).toBeUndefined();
    expect(trailingLine(history, { ...progress, kind: "ask" })).toBeUndefined();
    expect(trailingLine([], progress)).toBe(progress);
    expect(trailingLine(history, undefined)).toBeUndefined();
  });

  it("counts on the folded dot what waits or came meanwhile", () => {
    expect(badgeOf(0, 0)).toBe(0);
    expect(badgeOf(2, 1)).toBe(2);
    expect(badgeOf(0, 3)).toBe(3);
  });

  it("cuts a task name or title to one line", () => {
    expect(cut("修\n登录", 10)).toBe("修 登录");
    const long = cut("字".repeat(200), 30);
    expect(long).toHaveLength(30);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("pet frames", () => {
  it("plays each clip with its frame times, after the rest", () => {
    const resting = ANIMATIONS.resting;
    expect(frameAt(resting, 0)).toEqual({ column: 0, next: 2_400 });
    expect(frameAt(resting, 2_400)).toEqual({ column: 0, next: 280 });
    expect(frameAt(resting, 2_400 + 280 + 50)).toEqual({ column: 1, next: 60 });
    // the next round starts with the rest again
    expect(frameAt(resting, 2_400 + 1_100).column).toBe(0);
  });

  it("loops busy clips, stops a failure on its last frame, keeps sleep still", () => {
    expect(frameAt(ANIMATIONS.working, 820)).toEqual({ column: 0, next: 120 });
    expect(frameAt(ANIMATIONS.error, 10_000)).toEqual({
      column: 7,
      next: Number.POSITIVE_INFINITY,
    });
    expect(frameAt(ANIMATIONS.sleeping, 5_000)).toEqual({
      column: 0,
      next: Number.POSITIVE_INFINITY,
    });
  });

  it("gives every clip its own row inside the atlas", () => {
    const rows = Object.values(ANIMATIONS).map((a) => a.row);
    expect(new Set(rows).size).toBe(rows.length);
    for (const a of Object.values(ANIMATIONS)) {
      expect(a.row).toBeLessThan(ATLAS.rows);
      expect(a.durations.length).toBeLessThanOrEqual(ATLAS.columns);
    }
    expect(HELLO_MS).toBe(700);
  });
});

describe("the conversation (ADR 0070)", () => {
  it("heads a line with its task and how it ended", () => {
    const at = "2026-11-17T12:00:00Z";
    expect(historyHead({ id: 1, at, kind: "owner", text: "搜面馆" })).toBeUndefined();
    expect(historyHead({ id: 2, at, kind: "say", text: "好" })).toBeUndefined();
    expect(historyHead({ id: 3, at, kind: "task", text: "搜索中", task: "面馆" })).toBe("「面馆」");
    expect(
      historyHead({ id: 4, at, kind: "report", text: "找到了", task: "面馆", result: "done" }),
    ).toBe("「面馆」做完了");
    expect(
      historyHead({ id: 5, at, kind: "report", text: "没找到", task: "面馆", result: "failed" }),
    ).toBe("「面馆」没做成");
  });

  it("shows the time, with the date for an earlier day", () => {
    const now = new Date(2026, 10, 17, 23, 0);
    expect(clockOf(new Date(2026, 10, 17, 9, 5).toISOString(), now)).toBe("09:05");
    expect(clockOf(new Date(2026, 10, 16, 21, 30).toISOString(), now)).toBe("11-16 21:30");
    expect(clockOf("not a date", now)).toBe("");
  });
});

describe("sizing the conversation (ADR 0070)", () => {
  const room = { width: 900, list: 700 };

  it("grows up and to the left from the figure: dragging left or up makes it bigger", () => {
    const start = { width: 360, list: 420 };
    expect(dragChat(start, "corner", -100, -80, room)).toEqual({ width: 460, list: 500 });
    expect(dragChat(start, "left", -100, -80, room)).toEqual({ width: 460, list: 420 });
    expect(dragChat(start, "top", -100, -80, room)).toEqual({ width: 360, list: 500 });
    expect(dragChat(start, "corner", 30, 20, room)).toEqual({ width: 330, list: 400 });
  });

  it("stays between the minimum and what fits on the screen", () => {
    const start = { width: 360, list: 420 };
    expect(dragChat(start, "corner", 500, 500, room)).toEqual(CHAT_MIN);
    expect(dragChat(start, "corner", -2000, -2000, room)).toEqual(room);
    // A small screen wins over the minimum: the pet never leaves the screen.
    expect(fitChat(CHAT_DEFAULT, { width: 250, list: 200 })).toEqual({ width: 250, list: 200 });
  });

  it("keeps the owner's size, and falls back to the default", () => {
    expect(readChatSize(null)).toEqual(CHAT_DEFAULT);
    expect(readChatSize("{broken")).toEqual(CHAT_DEFAULT);
    expect(readChatSize('{"width":"wide"}')).toEqual(CHAT_DEFAULT);
    expect(readChatSize('{"width":520,"list":610}')).toEqual({ width: 520, list: 610 });
    expect(readChatSize('{"width":10,"list":10}')).toEqual(CHAT_MIN);
  });

  it("opens a long newest message at its first line, a short one at the bottom", () => {
    // newest message starts at 3247 in a list that scrolls to 3448: show its start
    expect(newestScroll(3247, 3448)).toBe(3247);
    // newest message starts below the last screenful: just the bottom
    expect(newestScroll(900, 640)).toBe(640);
    expect(newestScroll(-4, 0)).toBe(0);
  });

  it("keeps optimistic owner messages only until herd.db history records them", () => {
    const at = "2026-11-18T08:00:00Z";
    const h = (id: number, text: string) => ({ id, at, kind: "owner" as const, text });
    const pending = [
      { id: -1, at, text: "好", afterId: 5 },
      { id: -2, at, text: "好", afterId: 5 },
      { id: -3, at, text: "再查下", afterId: 5 },
    ];
    expect(remainingSays(pending, [h(3, "好")])).toEqual(pending);
    expect(remainingSays(pending, [h(3, "好"), h(6, "好")])).toEqual([pending[1], pending[2]]);
    expect(remainingSays(pending, [h(6, "好"), h(7, "好"), h(8, "再查下")])).toEqual([]);
  });

  it("lets clicks pass through empty transparent space outside interactive pet regions", () => {
    const size = { width: 412, height: 661 };
    const regions = [
      { x: 289, y: 516, width: 119, height: 137 },
      { x: 2, y: 2, width: 366, height: 522 },
    ];
    expect(hitPetRegion(340, 580, size, regions)).toBe(true);
    expect(hitPetRegion(180, 260, size, regions)).toBe(true);
    expect(hitPetRegion(40, 580, size, regions)).toBe(false);
    expect(hitPetRegion(390, 260, size, regions)).toBe(false);
    expect(hitPetRegion(-1, 200, size, regions)).toBe(false);
  });
});

describe("cards and tasks in the conversation (ADR 0072)", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 18, 10, m)).toISOString();
  const task = (id: string, started: number, stage: TasksView["tasks"][number]["stage"]) => ({
    id,
    title: `任务 ${id}`,
    project: "demo",
    agent: "Pi · deepseek/deepseek-flash",
    stage,
    lastReport: "在跑测试",
    startedAt: at(started),
    updatedAt: at(started + 5),
    automaticDecisions: [],
  });
  const report: PetCard = {
    ref: "f:r",
    at: at(20),
    open: false,
    view: {
      kind: "report",
      taskId: "t1",
      result: "done",
      title: "任务 t1",
      body: "做完了",
      summarized: false,
      automaticDecisions: [],
    },
  };

  it("puts lines, cards and tasks in time order", () => {
    const view: PetView = {
      connected: true,
      pending: [],
      history: [
        { id: 1, at: at(5), kind: "owner", text: "修一下登录" },
        { id: 2, at: at(30), kind: "say", text: "还有别的吗" },
      ],
      cards: [report],
      last: { id: 9, at: at(20), kind: "report", text: "做完了", card: "f:r" },
    };
    const tasks = [task("t1", 6, "done"), task("old", 1, "done")];
    expect(conversationOf(view, tasks, Date.parse(at(31))).map((e) => e.key)).toEqual([
      "h1",
      "tt1",
      "cf:r",
      "h2",
    ]);
  });

  it("shows the latest line once when it is not a card", () => {
    const view: PetView = {
      connected: true,
      pending: [],
      history: [{ id: 1, at: at(5), kind: "owner", text: "在吗" }],
      cards: [],
      last: { id: 4, at: at(6), kind: "task", text: "开始干活了", task: "任务 t1" },
    };
    expect(conversationOf(view, [], Date.parse(at(7))).map((e) => e.key)).toEqual(["h1", "l4"]);
  });

  it("with no conversation shows the tasks of the last day", () => {
    const view: PetView = { connected: true, pending: [], history: [], cards: [] };
    const now = Date.parse(at(0)) + 2 * 86_400_000;
    const tasks = [task("new", 0, "working"), task("older", 0, "done")];
    tasks[0] = { ...tasks[0], startedAt: new Date(now - 3_600_000).toISOString() } as never;
    expect(conversationOf(view, tasks, now).map((e) => e.key)).toEqual(["tnew"]);
  });

  it("tells how long a task runs and whether it can be stopped", () => {
    const running = task("a", 0, "working");
    expect(canStop(running)).toBe(true);
    expect(elapsedOf(running, Date.parse(at(0)) + 45_000)).toBe("45 秒");
    expect(elapsedOf(running, Date.parse(at(0)) + 3 * 3_600_000 + 5 * 60_000)).toBe("3 小时 5 分");
    const done = task("b", 0, "done");
    expect(canStop(done)).toBe(false);
    // An ended task counts until its last change, not until now.
    expect(elapsedOf(done, Date.parse(at(0)) + 86_400_000)).toBe("5 分钟");
  });

  it("shows the step of a running or waiting task, none once it ended", () => {
    expect(stepOf(task("a", 0, "working"))).toBe("在跑测试");
    expect(stepOf(task("b", 0, "needs-owner"))).toBe("在跑测试");
    const reported = { lastReport: "已报告：做完了，测试都过了" };
    expect(stepOf({ ...task("c", 0, "done"), ...reported })).toBeUndefined();
    expect(stepOf({ ...task("d", 0, "failed"), ...reported })).toBeUndefined();
    expect(stepOf({ ...task("e", 0, "queued"), lastReport: "  " })).toBeUndefined();
  });

  it("colors report cards and folds long bodies as Feishu does", () => {
    expect(reportHead({ ...report.view, result: "failed" } as never)).toEqual({
      icon: "❌",
      tone: "red",
    });
    expect(reportHead({ ...report.view, result: "stopped" } as never).tone).toBe("gray");
    expect(foldBody("短的")).toEqual({ head: "短的", folded: false });
    const long = `${"甲".repeat(300)}\n${"乙".repeat(300)}`;
    expect(foldBody(long)).toEqual({ head: "甲".repeat(300), folded: true });
    expect(foldBody("丙".repeat(FOLD_CHARS + 1)).head).toHaveLength(FOLD_CHARS);
  });
});

describe("the conversation's new look (ADR 0073)", () => {
  it("folds long replies and counts the lines behind 展开全文", () => {
    expect(foldOf("短短一句")).toEqual({ folded: false, more: 0 });
    expect(foldOf(Array.from({ length: 20 }, (_, i) => `第 ${i} 行`).join("\n"))).toEqual({
      folded: true,
      more: 12,
    });
    expect(foldOf("长".repeat(800)).folded).toBe(true);
  });

  it("puts a time line at a new day and after a pause", () => {
    const now = new Date(2026, 10, 18, 16, 0);
    const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
    expect(separatorOf(at(18, 11, 43), undefined, now)).toBe("今天 11:43");
    expect(separatorOf(at(17, 9, 5), undefined, now)).toBe("昨天 09:05");
    expect(separatorOf(at(9, 9, 5), undefined, now)).toBe("11-09 09:05");
    expect(separatorOf(at(18, 11, 45), at(18, 11, 43), now)).toBeUndefined();
    const later = new Date(Date.parse(at(18, 11, 43)) + GAP_MS).toISOString();
    expect(separatorOf(later, at(18, 11, 43), now)).toBe("11:53");
    expect(separatorOf(at(18, 8, 0), at(17, 23, 0), now)).toBe("今天 08:00");
  });

  it("splits a task's event into the task and what happened", () => {
    expect(eventOf("下载并启动 yetone/magpie: cd /tmp/magpie-run && curl -L x")).toEqual({
      task: "下载并启动 yetone/magpie",
      text: "cd /tmp/magpie-run && curl -L x",
    });
    expect(eventOf("没有冒号的一行")).toEqual({ text: "没有冒号的一行" });
  });

  it("says how AgentHerd is doing under 主管, and names models short", () => {
    expect(statusOf(false, 2)).toBe("还没连上飞书");
    expect(statusOf(true, 0)).toBe("飞书已连接");
    expect(statusOf(true, 2)).toBe("飞书已连接 · 2 个任务在跑");
    expect(modelName("deepseek/deepseek-flash")).toBe("deepseek-flash");
    expect(modelName(undefined)).toBeUndefined();
  });
});

describe("the pet's pages (ADR 0078)", () => {
  it("names a task's model once", () => {
    expect(runnerOf("Pi · deepseek/deepseek-flash", "deepseek/deepseek-flash")).toBe(
      "Pi · deepseek-flash",
    );
    expect(runnerOf("pi", "deepseek/deepseek-flash")).toBe("pi · deepseek-flash");
    expect(runnerOf("Codex · gpt-5.5", "openai/gpt-5.5")).toBe("Codex · gpt-5.5");
    expect(runnerOf("pi", undefined)).toBe("pi");
  });

  const NOW_AT = Date.UTC(2026, 10, 19, 12, 0);
  const ago = (min: number) => new Date(NOW_AT - min * 60_000).toISOString();
  const task = (id: string, stage: TasksView["tasks"][number]["stage"], updated: number) => ({
    id,
    title: `任务 ${id}`,
    project: "demo",
    agent: "Pi",
    stage,
    lastReport: "",
    startedAt: ago(updated + 10),
    updatedAt: ago(updated),
    automaticDecisions: [],
  });
  const card = (ref: string, min: number, open: boolean): PetCard => ({
    ref,
    at: ago(min),
    open,
    view: { kind: "ask", askId: ref, text: "要哪种？", options: [] },
  });

  it("remembers the page, the conversation when unknown", () => {
    expect(readTab("tasks")).toBe("tasks");
    expect(readTab("cards")).toBe("cards");
    expect(readTab(null)).toBe("chat");
    expect(readTab("board")).toBe("chat");
  });

  it("lists running tasks, the ones waiting for the owner first, then the last day's ended", () => {
    const { running, ended } = taskGroups(
      [
        task("w1", "working", 5),
        task("w2", "working", 1),
        task("n", "needs-owner", 30),
        task("q", "queued", 0),
        task("d", "done", 20),
        task("f", "failed", 3),
        task("old", "done", TASKS_ENDED_MS / 60_000 + 5),
      ],
      NOW_AT,
    );
    expect(running.map((t) => t.id)).toEqual(["n", "w2", "w1", "q"]);
    expect(ended.map((t) => t.id)).toEqual(["f", "d"]);
  });

  it("puts cards that wait for the owner first, as they came, then the others newest first", () => {
    const { waiting, recent } = cardGroups([
      card("a", 50, false),
      card("b", 40, true),
      card("c", 30, false),
      card("d", 20, true),
      card("e", 10, false),
    ]);
    expect(waiting.map((c) => c.ref)).toEqual(["b", "d"]);
    expect(recent.map((c) => c.ref)).toEqual(["e", "c", "a"]);
  });
});

describe("task dots and dropped files (ADR 0082)", () => {
  const NOW_AT = Date.UTC(2026, 10, 19, 12, 0);
  const task = (id: string, stage: TasksView["tasks"][number]["stage"], updated: number) => ({
    id,
    title: `任务 ${id}`,
    project: "demo",
    agent: "Pi",
    stage,
    lastReport: "",
    startedAt: new Date(NOW_AT - (updated + 10) * 60_000).toISOString(),
    updatedAt: new Date(NOW_AT - updated * 60_000).toISOString(),
    automaticDecisions: [],
  });

  it("puts one dot per running task over the pet, waiting ones first", () => {
    const { dots, more } = taskDots(
      [
        task("w", "working", 1),
        task("n", "needs-owner", 30),
        task("s", "stuck", 3),
        task("d", "done", 2),
        task("q", "queued", 0),
      ],
      NOW_AT,
    );
    expect(dots.map((d) => [d.id, d.tone])).toEqual([
      ["n", "amber"],
      ["s", "red"],
      ["w", "blue"],
      ["q", "gray"],
    ]);
    expect(dots[0]?.label).toBe("任务 n · 等你");
    expect(more).toBe(0);
    const many = Array.from({ length: TASK_DOTS_MAX + 2 }, (_, i) => task(`t${i}`, "working", i));
    expect(taskDots(many, NOW_AT).more).toBe(2);
    expect(taskDots([], NOW_AT).dots).toEqual([]);
  });

  it("keeps dropped files once each, up to the limit, with their names", () => {
    const first = addDrops([], ["/Users/me/Desktop/screen.PNG", "", "C:\\docs\\plan.pdf"], 3);
    expect(first).toEqual([
      { path: "/Users/me/Desktop/screen.PNG", name: "screen.PNG", picture: true },
      { path: "C:\\docs\\plan.pdf", name: "plan.pdf", picture: false },
    ]);
    const next = addDrops(first, ["/Users/me/Desktop/screen.PNG", "/a/b/", "/c"], 3);
    expect(next.map((d) => d.name)).toEqual(["screen.PNG", "plan.pdf", "b"]);
  });
});

describe("guessing the owner's next message (ADR 0084)", () => {
  it("shows the guess only in an empty input while the chat is up", () => {
    const view = { suggestion: " 把 b 下载下来 " };
    expect(suggestionFor(view, "", 0, false)).toBe("把 b 下载下来");
    expect(suggestionFor(view, "把", 0, false)).toBeUndefined();
    expect(suggestionFor(view, "", 1, false)).toBeUndefined();
    expect(suggestionFor(view, "", 0, true)).toBeUndefined();
    expect(suggestionFor({}, "", 0, false)).toBeUndefined();
    expect(suggestionFor({ suggestion: "  " }, "", 0, false)).toBeUndefined();
  });
});
