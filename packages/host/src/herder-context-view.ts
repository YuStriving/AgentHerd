// The 主管 › 上下文 tab, read from herd.db alone (ADR 0095): the next request is rebuilt the way
// the Herder builds it, so the tab works while the Herder is off and right after a restart.

import type {
  HerderFoldRecord,
  HerderMessageRow,
  HerderRequestRecord,
  HerderUsageRow,
  Store,
} from "@agentherd/core";
import {
  CONTEXT_STATE_KEY,
  CONTEXT_WINDOW_MAX,
  HerderContext,
  measureContext,
  promptMessage,
  workingWindow,
} from "@agentherd/herder";
import type {
  HerderContextNow,
  HerderContextSegment,
  HerderContextView,
  HerderEventView,
  HerderFoldView,
  HerderMessageView,
  HerderRequestView,
  HerderRoundView,
  HerderUsage,
  HerderUsageDay,
} from "./api.ts";

type Message = Parameters<typeof measureContext>[0][number];
type Saved = ConstructorParameters<typeof HerderContext>[2];

/** Requests, rounds and events the tab gets at most. */
export const CONTEXT_REQUESTS_SHOWN = 500;
export const CONTEXT_ROUNDS_SHOWN = 600;
export const CONTEXT_EVENTS_SHOWN = 400;
/** Characters of one piece of the next request; the whole is a `herderMessages` call away. */
export const CONTEXT_ITEM_CHARS = 600;
/** Characters of one message in `herderMessages`, and messages per call. */
export const MESSAGE_TEXT_MAX = 2000;
export const MESSAGES_PER_CALL = 200;
/** Characters of a fold's originals. */
export const FOLD_TEXT_MAX = 60_000;

/** Sums with the cache hit rate: reads from the cache over everything the provider read. */
export function usageFrom(row: Omit<HerderUsageRow, "day">): HerderUsage {
  const read = row.input + row.cacheRead + row.cacheWrite;
  return {
    requests: row.requests,
    input: row.input,
    output: row.output,
    cacheRead: row.cacheRead,
    cacheWrite: row.cacheWrite,
    cost: row.cost,
    hitRate: read === 0 ? 0 : row.cacheRead / read,
  };
}

/** The text of a stored message: words, tool calls as `name(args)`, tool results. */
export function messageText(message: unknown): string {
  const m = message as { role?: string; content?: unknown };
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return "";
  const out: string[] = [];
  for (const c of m.content as {
    type?: string;
    text?: string;
    thinking?: string;
    name?: string;
    arguments?: unknown;
  }[]) {
    if (c.type === "text") out.push(c.text ?? "");
    else if (c.type === "thinking" && (c.thinking ?? "") !== "") out.push(`（想）${c.thinking}`);
    else if (c.type === "toolCall") out.push(`${c.name}(${JSON.stringify(c.arguments ?? {})})`);
    else if (c.type === "image") out.push("（图片）");
  }
  return out.join("\n\n");
}

function cut(text: string, max: number): { text: string; more: number } {
  return text.length <= max
    ? { text, more: 0 }
    : { text: text.slice(0, max), more: text.length - max };
}

function hitRate(r: HerderRequestRecord): number | undefined {
  const read = r.input + r.cacheRead + r.cacheWrite;
  return read === 0 ? undefined : r.cacheRead / read;
}

/** The innermost fold (not opened) that holds `seq`. */
function innermost(folds: readonly HerderFoldRecord[], seq: number): HerderFoldRecord | undefined {
  let best: HerderFoldRecord | undefined;
  for (const f of folds) {
    if (f.state === "opened" || seq < f.startSeq || seq > f.endSeq) continue;
    if (best === undefined || f.endSeq - f.startSeq < best.endSeq - best.startSeq) best = f;
  }
  return best;
}

/** What the model sees, in order: its active folds and the stretches between them. */
export function segmentsOf(
  rows: readonly HerderMessageRow[],
  folds: readonly HerderFoldRecord[],
): HerderContextSegment[] {
  const active = folds.filter((f) => f.state === "active").sort((a, b) => a.startSeq - b.startSeq);
  const out: HerderContextSegment[] = [];
  let raw: Extract<HerderContextSegment, { kind: "raw" }> | undefined;
  let next = 0;
  for (const row of rows) {
    const fold = active[next];
    if (fold !== undefined && row.seq >= fold.startSeq) {
      raw = undefined;
      out.push({
        kind: "fold",
        blockId: fold.blockId,
        startSeq: fold.startSeq,
        endSeq: fold.endSeq,
        messages: fold.messages,
        tokensBefore: fold.tokensBefore,
        tokensAfter: fold.tokensAfter,
      });
      next++;
    }
    const inside = active[next - 1];
    if (inside !== undefined && row.seq <= inside.endSeq) continue;
    if (raw === undefined) {
      raw = { kind: "raw", startSeq: row.seq, endSeq: row.seq, messages: 0, tokens: 0 };
      out.push(raw);
    }
    raw.endSeq = row.seq;
    raw.messages++;
    raw.tokens += row.tokens;
  }
  return out;
}

/** Each fold placed: its children, kinds, times and where the model reads its summary. */
export function foldViews(
  rows: readonly HerderMessageRow[],
  folds: readonly HerderFoldRecord[],
  pending: ReadonlySet<string>,
  /** Ids of the compress calls the next request carries; the model reads those folds' summaries there. */
  shownCalls?: ReadonlySet<string>,
): HerderFoldView[] {
  const active = folds.filter((f) => f.state === "active");
  const inActive = (seq: number) => active.some((f) => seq >= f.startSeq && seq <= f.endSeq);
  const bySeq = new Map(rows.map((r) => [r.seq, r]));
  return folds.map((f) => {
    const kinds: Record<string, number> = {};
    const rounds = new Set<number>();
    let startAt = "";
    let endAt = "";
    for (let seq = f.startSeq; seq <= f.endSeq; seq++) {
      const r = bySeq.get(seq);
      if (r === undefined) continue;
      kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
      rounds.add(r.round);
      if (startAt === "") startAt = r.at;
      endAt = r.at;
    }
    const summaryAt: HerderFoldView["summaryAt"] =
      f.state === "opened"
        ? "none"
        : f.state === "merged"
          ? "parent"
          : shownCalls !== undefined
            ? shownCalls.has((f.block as { compressCallId?: string }).compressCallId ?? "")
              ? "call"
              : "note"
            : f.callSeq !== undefined && !inActive(f.callSeq)
              ? "call"
              : "note";
    return {
      blockId: f.blockId,
      ...(f.parent === undefined ? {} : { parent: f.parent }),
      children: folds.filter((c) => c.parent === f.blockId).map((c) => c.blockId),
      level: f.level,
      state: f.state,
      by: f.by,
      ...(f.topic === undefined ? {} : { topic: f.topic }),
      summary: f.summary,
      startSeq: f.startSeq,
      endSeq: f.endSeq,
      messages: f.messages,
      rounds: rounds.size,
      kinds,
      startAt,
      endAt,
      ...(f.callSeq === undefined ? {} : { callSeq: f.callSeq }),
      summaryAt,
      tokensBefore: f.tokensBefore,
      tokensAfter: f.tokensAfter,
      createdAt: f.createdAt,
      ...(pending.has(f.blockId) ? { pending: true } : {}),
    };
  });
}

/** The rounds with their size and the fold each sits in. */
export function roundViews(
  store: Store,
  rows: readonly HerderMessageRow[],
  folds: readonly HerderFoldRecord[],
): HerderRoundView[] {
  const rounds = store.herder.rounds();
  const size = new Map<number, { messages: number; tokens: number; end: number }>();
  for (const r of rows) {
    const s = size.get(r.round) ?? { messages: 0, tokens: 0, end: r.seq };
    s.messages++;
    s.tokens += r.tokens;
    s.end = r.seq;
    size.set(r.round, s);
  }
  return rounds.slice(-CONTEXT_ROUNDS_SHOWN).map((r) => {
    const s = size.get(r.seq) ?? { messages: 0, tokens: 0, end: r.seq };
    const fold = innermost(folds, r.seq);
    return {
      seq: r.seq,
      endSeq: s.end,
      at: r.at,
      kind: r.kind,
      title: r.title,
      messages: s.messages,
      tokens: s.tokens,
      ...(fold === undefined ? {} : { fold: fold.blockId }),
    };
  });
}

/** The next request rebuilt from herd.db, and the folds as they would be then. */
function rebuild(
  store: Store,
  log: readonly Message[],
  window: number,
  windows: { model: number; choice: number },
): { now: HerderContextNow; folds: HerderFoldRecord[]; shownCalls: Set<string> } {
  const saved = store.herderFolds();
  const prompt = store.herder.prompt();
  const messages = prompt === undefined ? [...log] : [promptMessage(prompt) as Message, ...log];
  const context = new HerderContext(
    // The working window is worked out already; 0 lets the context use all of it.
    { contextWindow: () => window, contextCap: () => 0, messages: () => messages, audit: () => {} },
    log as Message[],
    store.getState<Saved>(CONTEXT_STATE_KEY),
    saved,
  );
  const view = context.project(messages);
  const measured = measureContext(view, window);
  const now: HerderContextNow = {
    tokens: measured.tokens,
    window: measured.window,
    foldAt: measured.foldAt,
    choice: windows.choice,
    ...(windows.model > 0 ? { modelWindow: windows.model } : {}),
    parts: measured.parts,
    items: measured.items.map((i) => ({
      ...i,
      ...cut(i.text, CONTEXT_ITEM_CHARS),
      more: i.more + Math.max(0, i.text.length - CONTEXT_ITEM_CHARS),
    })),
    ...(prompt === undefined ? { noPrompt: true } : {}),
  };
  const shownCalls = new Set<string>();
  for (const m of view)
    if (m.role === "assistant")
      for (const c of m.content)
        if (c.type === "toolCall" && c.name === "compress") shownCalls.add(c.id);
  return { now, folds: context.folds(log as Message[]), shownCalls };
}

/** Everything on the tab; `problem` says why the next request could not be rebuilt. */
export function herderContextView(
  store: Store,
  on: boolean,
  key: string,
  windows: { model: number; choice: number } = { model: 0, choice: CONTEXT_WINDOW_MAX },
): HerderContextView {
  const rows = store.herder.messages();
  const requests = store.herderRequests("", CONTEXT_REQUESTS_SHOWN);
  const last = requests.at(-1);
  // The owner's pick, never more than the model's own window (ADR 0097).
  const window = workingWindow(windows.model, windows.choice);
  const savedIds = new Set(store.herderFolds().map((f) => f.blockId));
  let now: HerderContextNow | undefined;
  let folds = store.herderFolds();
  let problem: string | undefined;
  let shownCalls: Set<string> | undefined;
  try {
    const built = rebuild(store, store.herderLog() as Message[], window, windows);
    now = built.now;
    folds = built.folds;
    shownCalls = built.shownCalls;
  } catch (error) {
    problem = (error as Error).message;
  }
  const pending = new Set(folds.map((f) => f.blockId).filter((id) => !savedIds.has(id)));
  const segments = segmentsOf(rows, folds);
  const active = folds.filter((f) => f.state === "active");
  const { days, total } = store.herder.requestDays();
  const lastHit = last === undefined ? undefined : hitRate(last);
  return {
    key,
    on,
    ...(now === undefined ? {} : { now }),
    ...(problem === undefined ? {} : { problem }),
    facts: {
      messages: rows.length,
      tokens: rows.reduce((n, r) => n + r.tokens, 0),
      rounds: store.herder.rounds().length,
      activeFolds: active.length,
      folds: folds.length,
      saved: active.reduce((n, f) => n + Math.max(0, f.tokensBefore - f.tokensAfter), 0),
      shown: segments.reduce((n, s) => n + (s.kind === "raw" ? s.messages : 0), 0),
      ...(lastHit === undefined ? {} : { lastHitRate: lastHit }),
    },
    segments,
    folds: foldViews(rows, folds, pending, shownCalls),
    rounds: roundViews(store, rows, folds),
    requests: requests.map(requestView),
    days: days.map((d): HerderUsageDay => ({ day: d.day, ...usageFrom(d) })),
    total: usageFrom(total),
    events: store.herderEvents("", CONTEXT_EVENTS_SHOWN).map(
      (e): HerderEventView => ({
        at: e.at,
        kind: e.kind,
        ...(e.round === undefined ? {} : { round: e.round }),
        data: e.data,
      }),
    ),
  };
}

function requestView(r: HerderRequestRecord): HerderRequestView {
  return {
    at: r.at,
    model: r.model,
    tokens: r.tokens,
    input: r.input,
    output: r.output,
    cacheRead: r.cacheRead,
    cacheWrite: r.cacheWrite,
    cost: r.cost ?? 0,
    ...(r.seq === undefined ? {} : { seq: r.seq }),
    ...(r.round === undefined ? {} : { round: r.round }),
    ...(r.parts === undefined ? {} : { parts: r.parts }),
    ...(r.failed === true ? { failed: true } : {}),
  };
}

/** Messages `from`–`to`, at most {@link MESSAGES_PER_CALL}, each cut. */
export function herderMessages(store: Store, from: number, to: number): HerderMessageView[] {
  const count = Math.max(0, Math.min(to - from + 1, MESSAGES_PER_CALL));
  return store.herder.messages(from, count).map((r) => ({
    seq: r.seq,
    at: r.at,
    role: r.role,
    kind: r.kind,
    ...(r.tool === undefined ? {} : { tool: r.tool }),
    round: r.round,
    tokens: r.tokens,
    ...cut(messageText(store.herder.message(r.seq)), MESSAGE_TEXT_MAX),
  }));
}

const ROLE_NAMES: Record<string, string> = {
  user: "进来的",
  assistant: "主管",
  toolResult: "工具结果",
};

/** The originals a fold stands for, as text with a line for each message. */
export function foldText(store: Store, blockId: string): string {
  const fold = store.herderFolds().find((f) => f.blockId === blockId);
  if (fold === undefined) throw new Error(`no fold ${blockId}`);
  const parts: string[] = [];
  let length = 0;
  for (const r of store.herder.messages(fold.startSeq, fold.endSeq - fold.startSeq + 1)) {
    const text = `#${r.seq} ${ROLE_NAMES[r.role] ?? r.role}${r.tool === undefined ? "" : ` · ${r.tool}`}\n${messageText(store.herder.message(r.seq))}`;
    parts.push(text);
    length += text.length + 2;
    if (length > FOLD_TEXT_MAX) break;
  }
  const all = parts.join("\n\n");
  return all.length <= FOLD_TEXT_MAX
    ? all
    : `${all.slice(0, FOLD_TEXT_MAX)}\n\n…（后面还有，太长没放）`;
}
