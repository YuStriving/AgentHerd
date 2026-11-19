// What the pet tells the owner outside its window (ADR 0079): system notifications for what waits
// for the owner and for task results, quiet hours and snoozes, and the menu bar's lines. Pure, so
// main and the pet's page decide the same way and tests need no Electron.

import {
  type HostStatus,
  type PetCard,
  type PetPending,
  type PetSettings,
  type PetView,
  QUIET_HOURS,
  type TasksView,
} from "@agentherd/host/api";

type Task = TasksView["tasks"][number];

/** The pet's pages a notification or the menu bar opens (ADR 0078). */
export type NoticeTab = "chat" | "tasks" | "cards";

export type QuietSettings = Pick<PetSettings, "quietHours" | "quietUntil">;

/** When 到明早 ends a snooze. */
export const MORNING_HOUR = 8;
/** How many shown things the watch remembers, so none is told twice. */
const SEEN_MAX = 500;

function minuteOf(hm: string): number {
  const [h, m] = hm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Whether the pet keeps quiet now: snoozed, or inside the quiet hours (they may cross midnight). */
export function isQuiet(s: QuietSettings | undefined, now: Date): boolean {
  if (s === undefined) return false;
  if (s.quietUntil !== "" && Date.parse(s.quietUntil) > now.getTime()) return true;
  if (!QUIET_HOURS.test(s.quietHours)) return false;
  const [from = "", to = ""] = s.quietHours.split("-");
  const a = minuteOf(from);
  const b = minuteOf(to);
  if (a === b) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** When a snooze ends: in an hour, or at 8:00 the next morning (today's when it is still night). */
export function snoozeUntil(choice: "hour" | "morning", now: Date): string {
  if (choice === "hour") return new Date(now.getTime() + 60 * 60_000).toISOString();
  const end = new Date(now);
  end.setHours(MORNING_HOUR, 0, 0, 0);
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return end.toISOString();
}

/** "HH:MM", or "明天 HH:MM" when it is not today. */
export function clockOfEnd(iso: string, now: Date): string {
  const end = new Date(iso);
  const hm = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  return end.toDateString() === now.toDateString() ? hm : `明天 ${hm}`;
}

/** Until when the pet is quiet, in words; undefined when it is not. */
export function quietLine(s: QuietSettings | undefined, now: Date): string | undefined {
  if (s === undefined || !isQuiet(s, now)) return undefined;
  if (s.quietUntil !== "" && Date.parse(s.quietUntil) > now.getTime()) {
    return `免打扰到 ${clockOfEnd(s.quietUntil, now)}`;
  }
  return `免打扰时段 ${s.quietHours}`;
}

/** One thing worth a notification. */
export interface Notice {
  /** What it is about, so it is told once. */
  key: string;
  kind: "waiting" | "result";
  title: string;
  body: string;
  /** Rings when the owner allows sound: a question, an approval, a task that failed or stalled. */
  ring: boolean;
  /** The page a click opens. */
  tab: NoticeTab;
  /** An approval's card and buttons, answered from the notification where the system allows. */
  target?: string;
  options?: { action: string; label: string }[];
  taskId?: string;
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function waitingNotice(p: PetPending): Notice {
  const approval = p.options.some((o) => o.action === "allow");
  const head = approval ? "⚠️ 等你确认" : "❓ 主管问你";
  const more = (p.count ?? 1) > 1 ? `（${p.count} 件）` : "";
  const notice: Notice = {
    key: `p:${p.target}#${p.count ?? 1}`,
    kind: "waiting",
    title: p.task === undefined ? `${head}${more}` : `${head} · ${p.task}${more}`,
    body: oneLine(p.body === "" ? p.title : `${p.title}\n${p.body}`, 180),
    ring: true,
    tab: "cards",
    target: p.target,
    options: p.options,
  };
  return notice;
}

const RESULT_HEAD = {
  done: { head: "✅", says: "做完了", ring: false },
  failed: { head: "❌", says: "没做成", ring: true },
  blocked: { head: "⚠️", says: "卡住了", ring: true },
  stopped: { head: "⏹", says: "停了", ring: false },
} as const;

function resultNotice(card: PetCard): Notice | undefined {
  const view = card.view;
  if (view.kind !== "report") return undefined;
  const r = RESULT_HEAD[view.result];
  return {
    key: `c:${card.ref}`,
    kind: "result",
    title: `${r.head} 「${oneLine(view.title, 40)}」${r.says}`,
    body: oneLine(view.body, 180),
    ring: r.ring,
    tab: "chat",
    taskId: view.taskId,
  };
}

/**
 * Remembers what the owner was already told. The first view only notes what is there: a restart
 * or a reconnect tells nothing old again.
 */
export class NoticeWatch {
  private readonly seen: string[] = [];
  private ready = false;

  next(view: PetView): Notice[] {
    const found: Notice[] = [
      ...view.pending.map(waitingNotice),
      ...(view.cards ?? []).flatMap((c) => resultNotice(c) ?? []),
    ];
    const fresh = this.ready ? found.filter((n) => !this.seen.includes(n.key)) : [];
    this.ready = true;
    for (const n of found) if (!this.seen.includes(n.key)) this.seen.push(n.key);
    if (this.seen.length > SEEN_MAX) this.seen.splice(0, this.seen.length - SEEN_MAX);
    // What waits first: it is what the owner has to act on.
    return fresh.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "waiting" ? -1 : 1));
  }
}

/** Several things at once make one notification, so the owner is not rung five times. */
export function mergeNotices(list: readonly Notice[]): Notice | undefined {
  const [first] = list;
  if (first === undefined) return undefined;
  if (list.length === 1) return first;
  const waiting = list.filter((n) => n.kind === "waiting").length;
  return {
    key: list.map((n) => n.key).join(","),
    kind: waiting > 0 ? "waiting" : "result",
    title:
      waiting > 0
        ? `AgentHerd · ${list.length} 件事，${waiting} 件等你`
        : `AgentHerd · ${list.length} 件事`,
    body: list.map((n) => n.title).join("\n"),
    ring: list.some((n) => n.ring),
    tab: waiting > 0 ? "cards" : "chat",
  };
}

/** Tasks not ended yet. */
export function runningTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.stage !== "done" && t.stage !== "failed");
}

/** What the menu bar says (ADR 0079). */
export interface MenuBarModel {
  /** Next to the icon on macOS: how many things wait, or nothing. */
  title: string;
  tooltip: string;
  /** The menu's first line. */
  status: string;
  waiting: number;
  running: number;
  quiet?: string;
}

export function menuBarModel(input: {
  connected: boolean;
  status?: Pick<HostStatus, "channel" | "pet">;
  tasks: readonly Task[];
  view?: PetView;
  now: Date;
}): MenuBarModel {
  const waiting = input.view?.pending.length ?? 0;
  const running = runningTasks(input.tasks).length;
  const quiet = quietLine(input.status?.pet, input.now);
  let status: string;
  if (!input.connected) status = "AgentHerd 服务未连接";
  else if (input.view?.connected === false) status = "还没连上飞书";
  else status = running > 0 ? `${running} 个任务在跑` : "没有任务在跑";
  const tooltip = [
    "AgentHerd",
    status,
    ...(waiting > 0 ? [`${waiting} 件等你处理`] : []),
    ...(quiet === undefined ? [] : [quiet]),
  ].join(" · ");
  return {
    title: waiting > 0 ? String(waiting) : "",
    tooltip,
    status,
    waiting,
    running,
    ...(quiet === undefined ? {} : { quiet }),
  };
}
