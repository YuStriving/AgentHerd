// What the desktop pet looks like and shows (ADR 0070). No model calls: its mood follows what the
// host reports. Pure functions, so they are easy to test.

import type { PetCard, PetCardView, PetLine, PetView, TasksView } from "@agentherd/host/api";

type ReportView = Extract<PetCardView, { kind: "report" }>;
type Task = TasksView["tasks"][number];
type Stage = Task["stage"];

/** Order of the six frames in a figure strip. */
export const MOODS = ["resting", "working", "waiting", "celebrate", "error", "sleeping"] as const;
export type Mood = (typeof MOODS)[number];

/** How long a finished or failed task shows on the pet. */
export const FLASH_MS = 6_000;
/** Nothing new and nothing running for this long: the pet dozes off. */
export const SLEEP_AFTER_MS = 2 * 60_000;

export interface MoodInput {
  view: PetView;
  /** Tasks queued or working. */
  working: number;
  /** A finished or failed task shows until this time. */
  flash?: { mood: "celebrate" | "error"; until: number };
  /** Last time anything happened (a line, a task change, the owner touching the pet). */
  lastActive: number;
  now: number;
  /** The app reaches the host. */
  online: boolean;
}

export function moodOf(i: MoodInput): Mood {
  if (i.view.pending.length > 0) return "waiting";
  if (i.flash !== undefined && i.flash.until > i.now) return i.flash.mood;
  if (i.working > 0) return "working";
  if (!i.online || i.now - i.lastActive >= SLEEP_AFTER_MS) return "sleeping";
  return "resting";
}

/** The mood a new line flashes, if any: a finished task cheers, a failure looks worried. */
export function flashOf(line: PetLine): "celebrate" | "error" | undefined {
  if (line.kind === "error") return "error";
  if (line.kind !== "report") return undefined;
  return line.result === "done" ? "celebrate" : "error";
}

/** One line of at most `max` characters, for a task name or an approval's title. */
export function cut(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * A line AgentHerd sent that the pet has not shown yet. The first look only takes note: what came
 * before the pet started is history, not news.
 */
export function newLine(seen: number | undefined, line: PetLine | undefined): boolean {
  return line !== undefined && seen !== undefined && line.id > seen;
}

/**
 * The latest line when the conversation does not hold it yet: a task's progress, an alarm, or a
 * message the Herder has not taken into its conversation. Shown after the conversation, so a
 * conversation that opened for a line always shows it. Asks are shown as their card instead.
 */
export function trailingLine(
  history: readonly PetLine[],
  last: PetLine | undefined,
): PetLine | undefined {
  if (last === undefined || last.kind === "ask") return undefined;
  const newest = history[history.length - 1];
  if (newest !== undefined && Date.parse(newest.at) > Date.parse(last.at)) return undefined;
  const head = (text: string) => text.replace(/\s+/g, "").slice(0, 40);
  return history.some((h) => head(h.text) === head(last.text)) ? undefined : last;
}

/** The number on the folded dot: what waits for the owner, or the lines that came while folded. */
export function badgeOf(pending: number, unread: number): number {
  return Math.max(pending, unread);
}

/** The small line above a message of the conversation: which task, and how it ended. */
export function historyHead(line: PetLine): string | undefined {
  if (line.kind === "owner" || line.task === undefined) return undefined;
  if (line.kind === "report") {
    const head = line.result === "done" ? "做完了" : line.result === "stopped" ? "停了" : "没做成";
    return `「${line.task}」${head}`;
  }
  return `「${line.task}」`;
}

/** 14:05 for today, 11-16 14:05 for an earlier day. */
export function clockOf(at: string, now = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString()
    ? time
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/** Size of the conversation: the panel's width and the height of its messages. */
export interface ChatSize {
  width: number;
  list: number;
}

export const CHAT_DEFAULT: ChatSize = { width: 360, list: 420 };
export const CHAT_MIN: ChatSize = { width: 280, list: 240 };

/** Which edges a grip moves: the panel grows from the figure's corner up and to the left. */
export type Grip = "left" | "top" | "corner";

/** The size within the minimum and the room on the screen (the room wins when it is smaller). */
export function fitChat(size: ChatSize, room: ChatSize): ChatSize {
  return {
    width: Math.round(Math.min(room.width, Math.max(CHAT_MIN.width, size.width))),
    list: Math.round(Math.min(room.list, Math.max(CHAT_MIN.list, size.list))),
  };
}

/** The size after dragging a grip by (dx, dy) screen pixels from where it started. */
export function dragChat(
  start: ChatSize,
  grip: Grip,
  dx: number,
  dy: number,
  room: ChatSize,
): ChatSize {
  return fitChat(
    {
      width: grip === "top" ? start.width : start.width - dx,
      list: grip === "left" ? start.list : start.list - dy,
    },
    room,
  );
}

/** A saved size, or the default when there is none or it is broken. */
export function readChatSize(saved: string | null): ChatSize {
  if (saved === null) return CHAT_DEFAULT;
  try {
    const v = JSON.parse(saved) as Partial<ChatSize>;
    if (typeof v.width === "number" && typeof v.list === "number")
      return fitChat({ width: v.width, list: v.list }, { width: Infinity, list: Infinity });
  } catch {
    // broken: the default
  }
  return CHAT_DEFAULT;
}

/**
 * Where the conversation scrolls to: the start of its newest message, or the bottom when that
 * message fits, so a long answer is read from its first line.
 */
export function newestScroll(newestTop: number, maxScroll: number): number {
  return Math.max(0, Math.min(maxScroll, newestTop));
}

/** One thing in the conversation: a line, a card sent to the owner, or a task (ADR 0072). */
export type Entry =
  | { kind: "line"; key: string; at: string; line: PetLine }
  | { kind: "card"; key: string; at: string; card: PetCard }
  | { kind: "task"; key: string; at: string; task: Task };

/** Tasks with no conversation to place them in: those of the last day. */
const TASKS_ALONE_MS = 24 * 60 * 60_000;

/**
 * The conversation as the pet shows it, oldest first: the Herder's lines, the cards sent to the
 * owner, and a card for every task started over the same time, where it started.
 */
export function conversationOf(view: PetView, tasks: readonly Task[], now = Date.now()): Entry[] {
  const entries: Entry[] = view.history.map((line) => ({
    kind: "line",
    key: `h${line.id}`,
    at: line.at,
    line,
  }));
  // An older host sends no cards.
  const cards = view.cards ?? [];
  for (const card of cards) entries.push({ kind: "card", key: `c${card.ref}`, at: card.at, card });
  const last = view.last;
  const shownAsCard = last?.card !== undefined && cards.some((c) => c.ref === last.card);
  const trailing = shownAsCard ? undefined : trailingLine(view.history, last);
  if (trailing !== undefined) {
    entries.push({ kind: "line", key: `l${trailing.id}`, at: trailing.at, line: trailing });
  }
  const times = entries.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
  const from = times.length === 0 ? now - TASKS_ALONE_MS : Math.min(...times);
  for (const task of tasks) {
    if (Date.parse(task.startedAt) >= from) {
      entries.push({ kind: "task", key: `t${task.id}`, at: task.startedAt, task });
    }
  }
  return entries
    .map((e, i) => ({ e, i, t: Date.parse(e.at) || 0 }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ e }) => e);
}

/** The words on a task card for each stage. */
export const TASK_STAGE: Record<
  Stage,
  { text: string; tone: "blue" | "amber" | "green" | "red" | "gray" }
> = {
  queued: { text: "排队中", tone: "gray" },
  working: { text: "在做", tone: "blue" },
  "needs-owner": { text: "等你", tone: "amber" },
  stuck: { text: "卡住了", tone: "amber" },
  done: { text: "做完了", tone: "green" },
  failed: { text: "没做成", tone: "red" },
};

/** A task still running can be stopped; a finished one has nothing to stop. */
export function canStop(task: Task): boolean {
  return task.stage !== "done" && task.stage !== "failed";
}

/**
 * The step line under a task card: its latest report while it runs or waits. An ended task shows
 * none; its last report is 「已报告：…」, which only repeats the result card.
 */
export function stepOf(task: Task): string | undefined {
  if (!canStop(task)) return undefined;
  const step = task.lastReport.trim();
  return step === "" ? undefined : step;
}

/** How long a task has run: until now while it runs, until its last change once it ended. */
export function elapsedOf(task: Task, now = Date.now()): string {
  const end = canStop(task) ? now : Date.parse(task.updatedAt);
  const s = Math.max(0, Math.round((end - Date.parse(task.startedAt)) / 1000));
  if (Number.isNaN(s)) return "";
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} 小时` : `${h} 小时 ${m % 60} 分`;
}

/** The header of a report card: icon and color by how the task ended, as in Feishu. */
export function reportHead(view: ReportView): {
  icon: string;
  tone: "green" | "red" | "amber" | "gray";
} {
  switch (view.result) {
    case "done":
      return { icon: "✅", tone: "green" };
    case "failed":
      return { icon: "❌", tone: "red" };
    case "blocked":
      return { icon: "⚠️", tone: "amber" };
    default:
      return { icon: "⏹", tone: "gray" };
  }
}

/** Longer bodies are folded behind 展开全部, as in Feishu. */
export const FOLD_CHARS = 400;

/** The start of a long body, cut at a line end after half of `FOLD_CHARS` when there is one. */
export function foldBody(body: string): { head: string; folded: boolean } {
  if (body.length <= FOLD_CHARS) return { head: body, folded: false };
  const cutAt = body.lastIndexOf("\n", FOLD_CHARS);
  return {
    head: body.slice(0, cutAt > FOLD_CHARS / 2 ? cutAt : FOLD_CHARS).trimEnd(),
    folded: true,
  };
}

/** A reply longer than this is folded behind 「展开全文」. */
export const FOLD_LINES = 12;
export const FOLD_TEXT = 600;
/** Lines a folded reply shows. */
const FOLD_SHOWN = 8;

/** Whether a reply is folded, and how many more lines 「展开全文」 shows. */
export function foldOf(text: string): { folded: boolean; more: number } {
  const lines = text.split("\n").length;
  if (lines <= FOLD_LINES && text.length <= FOLD_TEXT) return { folded: false, more: 0 };
  return { folded: true, more: Math.max(0, lines - FOLD_SHOWN) };
}

/** A pause this long in the conversation gets a time line. */
export const GAP_MS = 10 * 60_000;

/**
 * The time line before an entry: the day and time at the start and on a new day, the time after a
 * pause of `GAP_MS`, nothing otherwise.
 */
export function separatorOf(
  at: string,
  previous: string | undefined,
  now = new Date(),
): string | undefined {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const before = previous === undefined ? undefined : new Date(previous);
  const sameDay = before !== undefined && before.toDateString() === d.toDateString();
  if (sameDay) return d.getTime() - before.getTime() >= GAP_MS ? time : undefined;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `今天 ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/** A task's event as one quiet line: which task, then what happened (「title: text」). */
export function eventOf(text: string): { task?: string; text: string } {
  const at = text.indexOf(": ");
  if (at <= 0 || at > 80) return { text };
  return { task: text.slice(0, at), text: text.slice(at + 2) };
}

/** The line under 「主管」 at the top of the conversation. */
export function statusOf(connected: boolean, working: number): string {
  if (!connected) return "还没连上飞书";
  return working > 0 ? `飞书已连接 · ${working} 个任务在跑` : "飞书已连接";
}

/** The model of a task without its service: "deepseek/deepseek-flash" → "deepseek-flash". */
export function modelName(model: string | undefined): string | undefined {
  if (model === undefined || model === "") return undefined;
  return model.slice(model.lastIndexOf("/") + 1);
}

/**
 * Who runs a task, short: the agent label already names the model on new hosts
 * ("Pi · deepseek/deepseek-flash"), so the model is not said twice.
 */
export function runnerOf(agent: string, model: string | undefined): string {
  const short = modelName(model);
  if (model === undefined || short === undefined) return agent;
  if (agent.includes(model)) return agent.replace(model, short);
  if (agent.includes(short)) return agent;
  return agent === "" ? short : `${agent} · ${short}`;
}

/** A message the owner just sent in the pet, before herd.db records its turn. */
export interface PendingSay {
  /** Negative id so React keys never collide with herd.db turn ids. */
  id: number;
  at: string;
  text: string;
  /** Highest history id when this message was sent. */
  afterId: number;
}

/**
 * Keeps optimistic owner messages until `history` holds their recorded `owner` turns (matched one
 * by one after `afterId`).
 */
export function remainingSays(
  pending: readonly PendingSay[],
  history: readonly PetLine[],
): PendingSay[] {
  const used = new Set<number>();
  const kept: PendingSay[] = [];
  for (const item of pending) {
    const match = history.find(
      (h) => h.kind === "owner" && h.id > item.afterId && h.text === item.text && !used.has(h.id),
    );
    if (match !== undefined) used.add(match.id);
    else kept.push(item);
  }
  return kept;
}

/** The pages of the expanded pet (ADR 0078): the conversation, the tasks, the cards. */
export const PET_TABS = ["chat", "tasks", "cards"] as const;
export type PetTab = (typeof PET_TABS)[number];

/** A saved page, or the conversation when there is none or it is unknown. */
export function readTab(saved: string | null): PetTab {
  return PET_TABS.find((t) => t === saved) ?? "chat";
}

/** Ended tasks the 任务 page still shows: those of the last day, as on the board. */
export const TASKS_ENDED_MS = 24 * 60 * 60_000;

/** Running tasks that need the owner come first. */
const RUNNING_ORDER: Record<Stage, number> = {
  "needs-owner": 0,
  stuck: 1,
  working: 2,
  queued: 3,
  done: 4,
  failed: 4,
};

/**
 * The 任务 page: tasks still running (waiting for the owner or stuck first, then the newest), and
 * those that ended in the last day, newest first.
 */
export function taskGroups(
  tasks: readonly Task[],
  now = Date.now(),
): { running: Task[]; ended: Task[] } {
  const newest = (a: Task, b: Task) =>
    (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
  const running = tasks
    .filter(canStop)
    .sort((a, b) => RUNNING_ORDER[a.stage] - RUNNING_ORDER[b.stage] || newest(a, b));
  const ended = tasks
    .filter((t) => !canStop(t) && now - (Date.parse(t.updatedAt) || 0) <= TASKS_ENDED_MS)
    .sort(newest);
  return { running, ended };
}

/**
 * The 卡片 page: cards whose buttons still work (waiting for the owner), in the order they came,
 * then the others, newest first.
 */
export function cardGroups(cards: readonly PetCard[]): { waiting: PetCard[]; recent: PetCard[] } {
  const waiting = cards.filter((c) => c.open);
  const recent = cards
    .map((c, i) => ({ c, i, t: Date.parse(c.at) || 0 }))
    .filter(({ c }) => !c.open)
    .sort((a, b) => b.t - a.t || b.i - a.i)
    .map(({ c }) => c);
  return { waiting, recent };
}

/** Dots over the pet's head, one per running task (ADR 0082). */
export const TASK_DOTS_MAX = 5;

export interface TaskDot {
  id: string;
  title: string;
  tone: "blue" | "amber" | "red" | "gray";
  /** What a dot's tooltip says: 「修登录 401 · 在做」. */
  label: string;
}

/**
 * The running tasks as dots, those waiting on the owner first; `more` counts the rest. A stuck
 * task is red here: on the pet's body it is what needs a look.
 */
export function taskDots(
  tasks: readonly Task[],
  now = Date.now(),
): { dots: TaskDot[]; more: number } {
  const running = taskGroups(tasks, now).running;
  const dots = running.slice(0, TASK_DOTS_MAX).map((task) => {
    const stage = TASK_STAGE[task.stage];
    const tone =
      task.stage === "stuck"
        ? "red"
        : stage.tone === "green"
          ? "blue"
          : (stage.tone as TaskDot["tone"]);
    return { id: task.id, title: task.title, tone, label: `${task.title} · ${stage.text}` };
  });
  return { dots, more: running.length - dots.length };
}

/** A file dropped on the pet, waiting to be sent with the next message (ADR 0082). */
export interface Drop {
  path: string;
  name: string;
  picture: boolean;
}

/** Adds dropped paths to those already waiting: no repeats, at most `max`, empty paths left out. */
export function addDrops(current: readonly Drop[], paths: readonly string[], max: number): Drop[] {
  const next = [...current];
  for (const path of paths) {
    if (path === "" || next.some((d) => d.path === path)) continue;
    if (next.length >= max) break;
    const name =
      path
        .split(/[\\/]/)
        .filter((x) => x !== "")
        .at(-1) ?? path;
    next.push({ path, name, picture: /\.(png|jpe?g|gif|webp)$/i.test(path) });
  }
  return next;
}

/**
 * The Herder's guess at the owner's next message, shown in the empty input (ADR 0084): only
 * while nothing is typed or dropped and the chat is up.
 */
export function suggestionFor(
  view: Pick<PetView, "suggestion">,
  draft: string,
  drops: number,
  offline: boolean,
): string | undefined {
  if (offline || draft !== "" || drops > 0) return undefined;
  const text = view.suggestion?.trim();
  return text === undefined || text === "" ? undefined : text;
}
