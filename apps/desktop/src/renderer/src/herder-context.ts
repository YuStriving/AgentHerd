// Labels, colours, layouts and the fold tree for the 主管 page's 上下文 tab (ADR 0093, ADR 0095).
// Kept apart from the page so they can be tested without React.

import type {
  HerderContextNow,
  HerderContextPart,
  HerderContextParts,
  HerderContextView,
  HerderEventView,
  HerderFoldView,
  HerderRequestView,
  HerderRoundView,
} from "@agentherd/host/api";

/** The parts in the order the model reads them. */
export const CONTEXT_PARTS: readonly HerderContextPart[] = [
  "system",
  "tools",
  "memory",
  "folds",
  "owner",
  "herder",
  "results",
];

/** The parts that open every request, before the conversation. */
export const HEAD_PARTS: readonly HerderContextPart[] = ["system", "tools", "memory"];

export const PART_LABELS: Record<HerderContextPart, string> = {
  system: "系统提示词",
  tools: "工具定义",
  memory: "记忆",
  folds: "折叠摘要",
  owner: "你的话和事件",
  herder: "主管的回复和调用",
  results: "工具结果",
};

/** What each part is, in one line, for the legend's tooltip. */
export const PART_HINTS: Record<HerderContextPart, string> = {
  system: "主管的规则、说话风格、折叠规则和连接的账号",
  tools: "主管能调用的每个工具的说明",
  memory: "每次都带上的记忆：你的画像、关于你、定了的事、主管笔记",
  folds: "旧对话折叠后的摘要，和 AgentHerd 加的提醒",
  owner: "你说的话、你的回答，和任务结果之类的事件",
  herder: "主管写的回复和它发出的工具调用",
  results: "工具返回的内容：任务列表、网页、搜索结果……",
};

export const PART_COLORS: Record<HerderContextPart, string> = {
  system: "#8e8e93",
  tools: "#f59e0b",
  memory: "#a855f7",
  folds: "#e8a33d",
  owner: "#22c55e",
  herder: "#3b82f6",
  results: "#14b8a6",
};

/** Colours of the request and day charts. */
export const CACHE_COLOR = "#5ec4b6";
export const INPUT_COLOR = "#5b8def";
export const FOLD_COLOR = PART_COLORS.folds;

/** 812 → "812", 19_400 → "19.4k", 1_250_000 → "1.25M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 100 ? k.toFixed(1) : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(2) : m.toFixed(1)}M`;
}

/** A share as a percent with one decimal under 10 %, none above; "0%" for an empty total. */
export function percent(part: number, total: number): string {
  if (total <= 0) return "0%";
  const p = (part / total) * 100;
  if (p > 0 && p < 0.1) return "<0.1%";
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

/** Dollars: "$0.44", "<$0.01", "$0". */
export function dollars(n: number): string {
  if (n <= 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n < 100 ? n.toFixed(2) : Math.round(n)}`;
}

/** The parts with tokens, largest first, for the legend. */
export function partsBySize(parts: HerderContextParts): HerderContextPart[] {
  return CONTEXT_PARTS.filter((p) => parts[p] > 0).sort((a, b) => parts[b] - parts[a]);
}

/** The pieces of one part, largest first. */
export function itemsOf(now: HerderContextNow, part: HerderContextPart) {
  return now.items.filter((i) => i.part === part).sort((a, b) => b.tokens - a.tokens);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "MM-DD" in local time. */
export function dayOf(at: string): string {
  const d = new Date(at);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "MM-DD HH:MM" in local time. */
export function clockOf(at: string): string {
  const d = new Date(at);
  return `${dayOf(at)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "HH:MM" today, "MM-DD HH:MM" before. */
export function timeOf(at: string, now = new Date()): string {
  const d = new Date(at);
  return d.toDateString() === now.toDateString()
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : clockOf(at);
}

/** "11-19 21:31 → 11-20 12:16"; one time when both are the same minute. */
export function spanOf(startAt: string, endAt: string): string {
  if (startAt === "") return "";
  const a = clockOf(startAt);
  const b = clockOf(endAt === "" ? startAt : endAt);
  if (a === b) return a;
  return a.slice(0, 5) === b.slice(0, 5) ? `${a} → ${b.slice(6)}` : `${a} → ${b}`;
}

export const FOLD_BY_LABELS: Record<HerderFoldView["by"], string> = {
  herder: "主管自己折的",
  forced: "快满时自动折的",
  overflow: "超出上限后折的",
};

/** Where the model reads a fold's summary, in a sentence. */
export function summaryWhere(f: HerderFoldView): string {
  switch (f.summaryAt) {
    case "call":
      return `摘要写在 #${f.callSeq} 那次 compress 调用里，模型在那个位置读到它`;
    case "note":
      return f.callSeq === undefined
        ? "摘要放在这一段原来的位置"
        : `那次 compress 调用（#${f.callSeq}）后来也折进去了，摘要放在这一段原来的位置`;
    case "parent":
      return `已经并进 ${f.parent ?? "上一层"}，模型只读 ${f.parent ?? "上一层"} 的摘要`;
    case "none":
      return "已经展开，模型读的是原文";
  }
}

const KIND_ORDER: readonly [string, string][] = [
  ["owner", "你的话"],
  ["answer", "你的回答"],
  ["task", "任务结果"],
  ["event", "事件"],
  ["scheduled", "定时"],
  ["intake", "新工作"],
  ["other", "其他"],
  ["reply", "主管回复"],
  ["call", "工具调用"],
  ["result", "工具结果"],
];

/** "你的话 3、主管回复 5、工具调用 2、工具结果 2". */
export function kindsLine(kinds: Record<string, number>): string {
  return KIND_ORDER.filter(([k]) => (kinds[k] ?? 0) > 0)
    .map(([k, label]) => `${label} ${kinds[k]}`)
    .join("、");
}

/** Who started a round, for its title. */
export const ROUND_LABELS: Record<string, string> = {
  owner: "你",
  answer: "你回答",
  task: "任务结果",
  event: "事件",
  scheduled: "定时",
  intake: "新工作",
  other: "其他",
};

/** A round's title line: "你：整理三月的发票". */
export function roundTitle(r: HerderRoundView): string {
  const who = ROUND_LABELS[r.kind] ?? r.kind;
  return r.title === "" ? who : `${who}：${r.title}`;
}

/** The colour of a message in the tree, by who wrote it. */
export function messageColor(role: string): string {
  return role === "assistant"
    ? PART_COLORS.herder
    : role === "toolResult"
      ? PART_COLORS.results
      : PART_COLORS.owner;
}

/** A message's line in the tree: a tool call, a tool result or the start of its words. */
export function messageLine(m: {
  role: string;
  kind: string;
  tool?: string;
  text: string;
}): string {
  if (m.kind === "call") return `调用 ${m.tool ?? "工具"}`;
  if (m.kind === "result") return `${m.tool ?? "工具"} 返回 ${m.text.length} 字`;
  const first =
    m.text
      .split("\n")
      .find(
        (line) =>
          line.trim() !== "" && !line.startsWith("[Now:") && !/^\[[A-Z][^\]]*\]$/.test(line.trim()),
      ) ?? "";
  return first.length > 120 ? `${first.slice(0, 120)}…` : first || "（没有文字）";
}

// ---------- the map: the whole conversation above, what goes out below, on one scale

export interface MapBox {
  /** The fold's id, "raw:<start>" for a stretch as it was, or the head part. */
  key: string;
  kind: "fold" | "raw" | "part";
  /** Share of the drawing's width, 0–1. */
  x: number;
  w: number;
  tokens: number;
  part?: HerderContextPart;
  blockId?: string;
  startSeq?: number;
  endSeq?: number;
}

export interface MapLayout {
  top: MapBox[];
  bottom: MapBox[];
  topTokens: number;
  bottomTokens: number;
  /** Where the window and the fold line fall on the same scale; past 1 when off the drawing. */
  windowAt?: number;
  foldAt?: number;
}

const MIN_BOX = 0.004;

export function segmentKey(s: HerderContextView["segments"][number]): string {
  return s.kind === "fold" ? s.blockId : `raw:${s.startSeq}`;
}

/** Boxes for the two bars of the map. Both use one scale, so the drop in size shows. */
export function mapLayout(view: HerderContextView): MapLayout {
  const head =
    view.now === undefined ? [] : HEAD_PARTS.filter((p) => (view.now?.parts[p] ?? 0) > 0);
  const topTokens = view.segments.reduce(
    (n, s) => n + (s.kind === "fold" ? s.tokensBefore : s.tokens),
    0,
  );
  const headTokens = head.reduce((n, p) => n + (view.now?.parts[p] ?? 0), 0);
  const bottomTokens =
    headTokens +
    view.segments.reduce((n, s) => n + (s.kind === "fold" ? s.tokensAfter : s.tokens), 0);
  const scale = Math.max(topTokens, bottomTokens, 1);
  const top: MapBox[] = [];
  let x = 0;
  for (const s of view.segments) {
    const tokens = s.kind === "fold" ? s.tokensBefore : s.tokens;
    const w = Math.max(MIN_BOX, tokens / scale);
    top.push(box(s, x, w, tokens));
    x += w;
  }
  const bottom: MapBox[] = [];
  x = 0;
  for (const p of head) {
    const tokens = view.now?.parts[p] ?? 0;
    const w = tokens / scale;
    bottom.push({ key: `part:${p}`, kind: "part", part: p, x, w, tokens });
    x += w;
  }
  for (const s of view.segments) {
    const tokens = s.kind === "fold" ? s.tokensAfter : s.tokens;
    const w = Math.max(MIN_BOX, tokens / scale);
    bottom.push(box(s, x, w, tokens));
    x += w;
  }
  return {
    top,
    bottom,
    topTokens,
    bottomTokens,
    ...(view.now === undefined
      ? {}
      : { windowAt: view.now.window / scale, foldAt: view.now.foldAt / scale }),
  };
}

function box(
  s: HerderContextView["segments"][number],
  x: number,
  w: number,
  tokens: number,
): MapBox {
  return {
    key: segmentKey(s),
    kind: s.kind,
    x,
    w,
    tokens,
    startSeq: s.startSeq,
    endSeq: s.endSeq,
    ...(s.kind === "fold" ? { blockId: s.blockId } : {}),
  };
}

// ---------- the tree: what the model reads, top to bottom

export interface ContextNode {
  id: string;
  kind: "part" | "fold" | "raw" | "round";
  title: string;
  /** Time or span, size and a short line of counts. */
  time?: string;
  meta?: string;
  tokens: number;
  /** For a fold: tokens before folding. */
  before?: number;
  part?: HerderContextPart;
  fold?: HerderFoldView;
  round?: HerderRoundView;
  startSeq?: number;
  endSeq?: number;
  children: ContextNode[];
}

/** The rounds that overlap a stretch of messages. */
function roundsIn(rounds: readonly HerderRoundView[], start: number, end: number) {
  return rounds.filter((r) => r.seq <= end && r.endSeq >= start);
}

function roundNode(r: HerderRoundView): ContextNode {
  return {
    id: `round:${r.seq}`,
    kind: "round",
    title: roundTitle(r),
    time: clockOf(r.at),
    meta: `${r.messages} 条`,
    tokens: r.tokens,
    round: r,
    startSeq: r.seq,
    endSeq: r.endSeq,
    children: [],
  };
}

function foldNode(f: HerderFoldView, view: HerderContextView): ContextNode {
  const inner = view.folds.filter((c) => c.parent === f.blockId).map((c) => foldNode(c, view));
  const own = view.rounds.filter((r) => r.fold === f.blockId).map(roundNode);
  const children = [...inner, ...own].sort((a, b) => (a.startSeq ?? 0) - (b.startSeq ?? 0));
  return {
    id: `fold:${f.blockId}`,
    kind: "fold",
    title: `${f.blockId} · ${f.topic ?? "折叠的一段"}`,
    time: spanOf(f.startAt, f.endAt),
    meta: `${f.messages} 条 · ${f.rounds} 轮${f.level > 1 ? ` · 第 ${f.level} 层` : ""}`,
    tokens: f.tokensAfter,
    before: f.tokensBefore,
    fold: f,
    startSeq: f.startSeq,
    endSeq: f.endSeq,
    children,
  };
}

/** The tree in the model's reading order: head parts, then each fold and each stretch. */
export function contextTree(view: HerderContextView): ContextNode[] {
  const nodes: ContextNode[] = [];
  if (view.now !== undefined) {
    for (const p of HEAD_PARTS) {
      const tokens = view.now.parts[p];
      if (tokens > 0)
        nodes.push({
          id: `part:${p}`,
          kind: "part",
          title: PART_LABELS[p],
          part: p,
          tokens,
          children: [],
        });
    }
  }
  const folds = new Map(view.folds.map((f) => [f.blockId, f]));
  for (const s of view.segments) {
    if (s.kind === "fold") {
      const f = folds.get(s.blockId);
      if (f !== undefined) nodes.push(foldNode(f, view));
      continue;
    }
    const rounds = roundsIn(view.rounds, s.startSeq, s.endSeq);
    const first = rounds[0];
    const last = rounds.at(-1);
    nodes.push({
      id: `raw:${s.startSeq}`,
      kind: "raw",
      title: s.startSeq === s.endSeq ? `原文 #${s.startSeq}` : `原文 #${s.startSeq}–#${s.endSeq}`,
      ...(first === undefined || last === undefined ? {} : { time: spanOf(first.at, last.at) }),
      meta: `${s.messages} 条${rounds.length > 0 ? ` · ${rounds.length} 轮` : ""}`,
      tokens: s.tokens,
      startSeq: s.startSeq,
      endSeq: s.endSeq,
      children: rounds.map(roundNode),
    });
  }
  return nodes;
}

// ---------- the drawn tree: folds and stretches as boxes joined by lines

export interface DrawnNode {
  id: string;
  /** Column (0 = the request) and the centre's row position in units of one box. */
  depth: number;
  row: number;
  node?: ContextNode;
}

export interface DrawnTree {
  nodes: DrawnNode[];
  links: { from: string; to: string }[];
  rows: number;
  depth: number;
}

/**
 * Left to right: the request, then the head (one box), each top fold and stretch, and the folds
 * inside folds further right. Rounds are left out; the list view has them.
 */
export function drawnTree(nodes: readonly ContextNode[]): DrawnTree {
  const out: DrawnNode[] = [];
  const links: { from: string; to: string }[] = [];
  let row = 0;
  let deepest = 1;
  const place = (n: ContextNode, depth: number, parent: string): number => {
    deepest = Math.max(deepest, depth);
    const inner = n.children.filter((c) => c.kind === "fold");
    links.push({ from: parent, to: n.id });
    let at: number;
    if (inner.length === 0) {
      at = row;
      row++;
    } else {
      const rows = inner.map((c) => place(c, depth + 1, n.id));
      at = ((rows[0] ?? 0) + (rows.at(-1) ?? 0)) / 2;
    }
    out.push({ id: n.id, depth, row: at, node: n });
    return at;
  };
  const head = nodes.filter((n) => n.kind === "part");
  if (head.length > 0) {
    links.push({ from: "request", to: "head" });
    out.push({ id: "head", depth: 1, row });
    row++;
  }
  for (const n of nodes) if (n.kind !== "part") place(n, 1, "request");
  out.push({ id: "request", depth: 0, row: Math.max(0, (row - 1) / 2) });
  return { nodes: out, links, rows: Math.max(row, 1), depth: deepest };
}

// ---------- requests and events

/** Index of the first request at or after each fold was made, for the ✂ marks. */
export function foldMarks(
  requests: readonly HerderRequestView[],
  folds: readonly HerderFoldView[],
): { index: number; blockId: string }[] {
  const out: { index: number; blockId: string }[] = [];
  for (const f of folds) {
    const index = requests.findIndex((r) => r.at >= f.createdAt);
    if (index >= 0) out.push({ index, blockId: f.blockId });
  }
  return out;
}

export interface ContextRecord {
  at: string;
  title: string;
  text: string;
  blockId?: string;
}

/** Folds made and other events, newest first. */
export function contextRecords(
  folds: readonly HerderFoldView[],
  events: readonly HerderEventView[],
): ContextRecord[] {
  const out: ContextRecord[] = folds.map((f) => ({
    at: f.createdAt,
    title: `${f.by === "herder" ? "主管折了" : f.by === "forced" ? "快满了，自动折了" : "超出上限，折了"} ${f.blockId}`,
    text: `${f.topic ?? ""}${f.topic === undefined ? "" : "："}${f.messages} 条，≈${formatTokens(f.tokensBefore)} → ${formatTokens(f.tokensAfter)}${f.state === "merged" ? `；后来并进 ${f.parent ?? "上一层"}` : f.state === "opened" ? "；后来展开了" : ""}`,
    blockId: f.blockId,
  }));
  for (const e of events) {
    const d = e.data;
    if (e.kind === "start")
      out.push({
        at: e.at,
        title: "主管启动",
        text: `从库里读回 ${Number(d.messages ?? 0)} 条对话、${Number(d.folds ?? 0)} 段折叠${Array.isArray(d.repaired) && d.repaired.length > 0 ? `，修正了 ${d.repaired.join("、")}` : ""}`,
      });
    else if (e.kind === "fold.repaired")
      out.push({
        at: e.at,
        title: `修正了 ${String(d.blockId)} 的范围`,
        text: `它切进了更早的一段，只保留真正新折的 #${String(d.startSeq)}–#${String(d.endSeq)}；送给模型的内容一字没变`,
        blockId: String(d.blockId),
      });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
