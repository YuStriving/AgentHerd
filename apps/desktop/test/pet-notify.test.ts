import type { PetCard, PetPending, PetView, TasksView } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";
import {
  clockOfEnd,
  isQuiet,
  menuBarModel,
  mergeNotices,
  NoticeWatch,
  quietLine,
  snoozeUntil,
} from "../src/shared/pet-notify.ts";

type Task = TasksView["tasks"][number];

/** A local time today. */
function at(hm: string, day = 19): Date {
  const [h, m] = hm.split(":").map(Number);
  return new Date(2026, 10, day, h, m);
}

const approval: PetPending = {
  target: "item-1",
  title: "运行 rm -rf ./logs/*",
  body: "",
  options: [
    { action: "allow", label: "同意" },
    { action: "deny", label: "拒绝" },
    { action: "skip", label: "跳过" },
  ],
  task: "清理旧日志",
};

function report(ref: string, result: "done" | "failed" | "blocked" | "stopped"): PetCard {
  return {
    ref,
    at: "2026-11-19T02:00:00.000Z",
    open: false,
    view: {
      kind: "report",
      taskId: `t-${ref}`,
      result,
      title: "修登录 401",
      body: "改了 token 刷新，测试过了。",
      summarized: false,
      automaticDecisions: [],
    },
  };
}

function view(pending: PetPending[] = [], cards: PetCard[] = []): PetView {
  return { connected: true, pending, history: [], cards };
}

function task(id: string, stage: Task["stage"]): Task {
  return {
    id,
    title: id,
    project: "/tmp",
    agent: "Pi",
    stage,
    lastReport: "",
    startedAt: "2026-11-19T02:00:00.000Z",
    updatedAt: "2026-11-19T02:00:00.000Z",
    automaticDecisions: 0,
  } as unknown as Task;
}

describe("quiet hours and snoozes (ADR 0079)", () => {
  it("keeps quiet inside the hours, also across midnight", () => {
    const night = { quietHours: "22:00-08:00", quietUntil: "" };
    expect(isQuiet(night, at("23:30"))).toBe(true);
    expect(isQuiet(night, at("07:59"))).toBe(true);
    expect(isQuiet(night, at("08:00"))).toBe(false);
    expect(isQuiet(night, at("12:00"))).toBe(false);
    const lunch = { quietHours: "12:00-13:30", quietUntil: "" };
    expect(isQuiet(lunch, at("12:45"))).toBe(true);
    expect(isQuiet(lunch, at("13:30"))).toBe(false);
    expect(isQuiet({ quietHours: "", quietUntil: "" }, at("23:30"))).toBe(false);
    expect(isQuiet(undefined, at("23:30"))).toBe(false);
  });

  it("snoozes for an hour or until 8 the next morning, and says until when", () => {
    const now = at("15:10");
    const hour = snoozeUntil("hour", now);
    expect(new Date(hour).getTime() - now.getTime()).toBe(3_600_000);
    expect(isQuiet({ quietHours: "", quietUntil: hour }, now)).toBe(true);
    expect(isQuiet({ quietHours: "", quietUntil: hour }, at("16:11"))).toBe(false);
    expect(quietLine({ quietHours: "", quietUntil: hour }, now)).toBe("免打扰到 16:10");
    const morning = snoozeUntil("morning", now);
    expect(new Date(morning)).toEqual(at("08:00", 20));
    expect(clockOfEnd(morning, now)).toBe("明天 08:00");
    // Before 8 in the morning it is this morning.
    expect(new Date(snoozeUntil("morning", at("02:00")))).toEqual(at("08:00"));
    expect(quietLine({ quietHours: "22:00-08:00", quietUntil: "" }, at("23:00"))).toBe(
      "免打扰时段 22:00-08:00",
    );
    expect(quietLine({ quietHours: "22:00-08:00", quietUntil: "" }, at("12:00"))).toBeUndefined();
  });
});

describe("what is worth a notification (ADR 0079)", () => {
  it("notes the first view and then tells only what is new, once", () => {
    const watch = new NoticeWatch();
    expect(watch.next(view([approval], [report("a", "done")]))).toEqual([]);
    expect(watch.next(view([approval], [report("a", "done")]))).toEqual([]);
    const next = watch.next(view([approval], [report("a", "done"), report("b", "failed")]));
    expect(next).toMatchObject([
      { key: "c:b", kind: "result", title: "❌ 「修登录 401」没做成", ring: true, tab: "chat" },
    ]);
    expect(watch.next(view([], [report("a", "done"), report("b", "failed")]))).toEqual([]);
  });

  it("tells an approval first, with its buttons, and a done task without sound", () => {
    const watch = new NoticeWatch();
    watch.next(view());
    const next = watch.next(view([approval], [report("c", "done")]));
    expect(next.map((n) => n.kind)).toEqual(["waiting", "result"]);
    expect(next[0]).toMatchObject({
      title: "⚠️ 等你确认 · 清理旧日志",
      body: "运行 rm -rf ./logs/*",
      ring: true,
      tab: "cards",
      target: "item-1",
    });
    expect(next[0]?.options?.map((o) => o.label)).toEqual(["同意", "拒绝", "跳过"]);
    expect(next[1]).toMatchObject({ title: "✅ 「修登录 401」做完了", ring: false });
    // A question has no 同意.
    const ask = watch.next(
      view([
        {
          target: "ask-1",
          title: "用哪个文件夹？",
          body: "",
          options: [{ action: "0", label: "A" }],
        },
      ]),
    );
    expect(ask[0]?.title).toBe("❓ 主管问你");
    // One more approval joins the combined card: told again with the new count.
    const more = watch.next(view([{ ...approval, count: 2 }]));
    expect(more[0]?.title).toBe("⚠️ 等你确认 · 清理旧日志（2 件）");
  });

  it("merges what comes together into one notification", () => {
    const watch = new NoticeWatch();
    watch.next(view());
    const list = watch.next(view([approval], [report("d", "done"), report("e", "stopped")]));
    const one = mergeNotices(list);
    expect(one).toMatchObject({ title: "AgentHerd · 3 件事，1 件等你", ring: true, tab: "cards" });
    expect(one?.body.split("\n")).toHaveLength(3);
    expect(one?.options).toBeUndefined();
    expect(mergeNotices([])).toBeUndefined();
    expect(mergeNotices(list.slice(1))?.title).toBe("AgentHerd · 2 件事");
  });
});

describe("the menu bar (ADR 0079)", () => {
  it("says how AgentHerd is doing", () => {
    const now = at("23:00");
    const pet = {
      on: true,
      figure: "deepseek" as const,
      notify: true,
      sound: true,
      quietHours: "22:00-08:00",
      quietUntil: "",
    };
    const m = menuBarModel({
      connected: true,
      status: { channel: "feishu", pet } as never,
      tasks: [task("a", "working"), task("b", "needs-owner"), task("c", "done")],
      view: view([approval]),
      now,
    });
    expect(m).toEqual({
      title: "1",
      tooltip: "AgentHerd · 2 个任务在跑 · 1 件等你处理 · 免打扰时段 22:00-08:00",
      status: "2 个任务在跑",
      waiting: 1,
      running: 2,
      quiet: "免打扰时段 22:00-08:00",
    });
    expect(menuBarModel({ connected: false, tasks: [], now }).status).toBe("AgentHerd 服务未连接");
    expect(
      menuBarModel({ connected: true, tasks: [], view: { ...view(), connected: false }, now })
        .status,
    ).toBe("还没连上飞书");
    expect(menuBarModel({ connected: true, tasks: [], view: view(), now })).toMatchObject({
      title: "",
      status: "没有任务在跑",
    });
  });
});
