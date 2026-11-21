// The Herder's context (ADR 0045): the whole conversation is kept, and the model folds parts it no
// longer needs into summaries it writes itself. The engine is our fork of billion-context's
// acp-kernel (packages/context-kernel); this file adapts it to the Herder's pi messages.

import { createHash } from "node:crypto";
import {
  blockDocs,
  buildCompressSystemPrompt,
  buildStatusReport,
  COMPRESS_TOOL_OPENAI,
  type CompressionBlock,
  type CompressionState,
  type Config,
  type CoreMessage,
  collectBlockContent,
  coveredMessageIds,
  createCore,
  createInitialState,
  defaultConfig,
  defaultCountTokens,
  type MessageInput,
  messageDocs,
  type Prompts,
  parseBlockIdArg,
  parseCompressArgs,
  prune,
  rebuildCompressionState,
  renderNudgeText,
  resolvePrompts,
  searchBlocks,
} from "@agentherd/context-kernel";
import {
  HERDER_CONTEXT_ITEM_TEXT_MAX,
  HERDER_CONTEXT_PARTS,
  type HerderContextItem,
  type HerderContextPart,
  type HerderContextParts,
  type HerderContextSnapshot,
  type HerderFoldBy,
  type HerderFoldRecord,
  type HerderPromptRecord,
} from "@agentherd/core";
import type { AgentMessage, AgentTool, AgentToolResult } from "@agentherd/herder-loop";
import { bool, int, obj, opt, str } from "@earendil-works/pi-schema";
import { OWNER_LABEL } from "./prompt.ts";

/** Where the memory starts in the system prompt (`memorySnapshot`). */
/** The first resident memory block (`[记忆 · <kind> — … 用量 N/cap 字]`), not a mention of one in the rules. */
const MEMORY_START = /^\[记忆 · [^\]\n]* — [^\]\n]*用量 /m;
const FOLD_START = "[Compressed conversation section]";

/**
 * Where the engine's bookkeeping (refs, counters, nudges) is saved. The messages are in
 * `herder_messages` and the folds in `herder_folds` (ADR 0095).
 */
export const CONTEXT_STATE_KEY = "herder.context";
/**
 * The working window the Herder uses unless the owner picks another (ADR 0097): the model's, but at
 * most this, and this when the model does not say. Every request sends the whole view, so a bigger
 * window makes each reply slower and dearer.
 */
export const CONTEXT_WINDOW_MAX = 128_000;
/** The working windows the owner can pick (ADR 0097); 0 is the model's whole window. */
export const CONTEXT_WINDOW_CHOICES = [64_000, 128_000, 256_000, 0] as const;

/**
 * The window the Herder works in: the owner's choice, never more than the model's. A choice of 0
 * means the model's whole window; a model that does not say gets the choice (or the default).
 */
export function workingWindow(model: number, choice: number = CONTEXT_WINDOW_MAX): number {
  if (choice <= 0) return model > 0 ? model : CONTEXT_WINDOW_MAX;
  return model > 0 ? Math.min(model, choice) : choice;
}
/** At this share of the window, unfolded old messages are folded without waiting for the model… */
export const FORCED_FOLD_AT = 0.9;
/** …until the context is down to about this share. */
export const FORCED_FOLD_TO = 0.6;
/** Characters one decompress returns; the rest is cut with a note. */
export const DECOMPRESS_MAX_CHARS = 60_000;
/** These tools change only what the model sees, so a turn that used them may run again. */
export const CONTEXT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "compress",
  "decompress",
  "search_context",
  "acp_status",
]);

const ID = /^h(\d+)(?:#(\d+))?$/;
/** Echoed ref tags; the model is told never to write them, this catches the slips. */
const TAG = /<acp\b[^>]*>[^<]*<\/acp>\n?/g;
/** A line that starts like a ref tag but ends some other way (`…>m00205</p>`): never meant for people. */
const TAG_LINE = /^[ \t]*<acp\b[^\n]*(?:\n|$)/gm;
/** The kernel's tag in front of a message's text. */
const LEADING_TAG = /^<acp\b[^>]*>[^<]*<\/acp>\n?/;
const MESSAGE_OVERHEAD = 4;

type Content = string | readonly { type: string; text?: string }[];

export interface ContextHooks {
  /** The current model's context window in tokens; 0 when unknown. */
  contextWindow(): number;
  /** The working window the owner picked (ADR 0097), 0 for the model's whole window; read each time. */
  contextCap?(): number;
  /** The agent's messages now, the leading system message included. */
  messages(): readonly AgentMessage[];
  audit(type: string, data: Record<string, unknown>): void;
  /** Something that happened to the conversation, for `herder_events` (ADR 0095). */
  event?(kind: string, data: Record<string, unknown>): void;
}

/**
 * Removes ref tags the model copied into text meant for people or agents: whole tags anywhere,
 * and lines that begin like a tag whatever their ending. (Tool calls written as text are caught
 * by `beforeToolMarkup`.)
 */
export function withoutContextMarks(text: string): string {
  return text.replace(TAG, "").replace(TAG_LINE, "");
}

/** `value` with ref tags removed from every string in it. */
export function withoutMarksDeep<T>(value: T): T {
  if (typeof value === "string") return withoutContextMarks(value) as T;
  if (Array.isArray(value)) return value.map((v) => withoutMarksDeep(v)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutMarksDeep(v)])) as T;
  }
  return value;
}

/** How many system messages lead the agent's messages (the prompt and tools); they are not logged. */
export function leadingSystem(messages: readonly AgentMessage[]): number {
  let n = 0;
  while (messages[n]?.role === "system") n++;
  return n;
}

/** The first position where `log` differs from what was saved. */
export function changedFrom(saved: readonly AgentMessage[], log: readonly AgentMessage[]): number {
  const n = Math.min(saved.length, log.length);
  let i = 0;
  while (i < n && saved[i] === log[i]) i++;
  return i;
}

function textOf(content: Content): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function idOf(index: number, part: number): string {
  return part === 0 ? `h${index}` : `h${index}#${part}`;
}

function indexOf(id: string): number {
  return Number(ID.exec(id)?.[1] ?? Number.NaN);
}

/**
 * The kernel keeps the first user message in view for good (it heads the prompt cache, and strict
 * providers want a user message). This fixed line takes that place, so the owner's first message
 * can be folded like any other.
 */
export const OPENING_TEXT =
  "[Start of the conversation with the owner. AgentHerd keeps all of it; folded parts show as summaries.]";

/**
 * The kernel's view of the log: the opening line, then one core message per text, thought, tool
 * call or result. Ids are positions in the log, which only grows, so they stay the same across
 * turns and restarts.
 */
export function toCore(log: readonly AgentMessage[]): CoreMessage[] {
  const out: CoreMessage[] = [
    { id: "opening", role: "user", contentType: "text", text: OPENING_TEXT },
  ];
  log.forEach((m, i) => {
    switch (m.role) {
      case "user":
        out.push({ id: idOf(i, 0), role: "user", contentType: "text", text: textOf(m.content) });
        return;
      case "toolResult":
        out.push({
          id: idOf(i, 0),
          role: "tool",
          contentType: "tool-result",
          toolName: m.toolName,
          toolCallId: m.toolCallId,
          text: textOf(m.content),
        });
        return;
      case "assistant":
        if (m.content.length === 0) {
          out.push({ id: idOf(i, 0), role: "assistant", contentType: "text", text: "" });
          return;
        }
        m.content.forEach((part, k) => {
          const id = idOf(i, k);
          if (part.type === "text") {
            out.push({ id, role: "assistant", contentType: "text", text: part.text });
          } else if (part.type === "thinking") {
            out.push({ id, role: "assistant", contentType: "reasoning", text: part.thinking });
          } else {
            out.push({
              id,
              role: "assistant",
              contentType: "tool-call",
              toolName: part.name,
              toolCallId: part.id,
              text: JSON.stringify(part.arguments),
            });
          }
        });
        return;
      default:
        out.push({ id: idOf(i, 0), role: "system", contentType: "text", text: textOf(m.content) });
    }
  });
  return out;
}

/** A note in the request only (a summary, a nudge); never saved. */
function note(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

/** The message with its text replaced by the kernel's (a ref tag in front, or cut down). */
function withText(m: AgentMessage, text: string): AgentMessage {
  if (m.role === "user") {
    if (text === textOf(m.content)) return m;
    if (typeof m.content === "string") return { ...m, content: text };
    return {
      ...m,
      content: [{ type: "text", text }, ...m.content.filter((c) => c.type !== "text")],
    };
  }
  if (m.role === "toolResult") {
    if (text === textOf(m.content)) return m;
    return {
      ...m,
      content: [{ type: "text", text }, ...m.content.filter((c) => c.type !== "text")],
    };
  }
  return m;
}

function rebuild(
  m: AgentMessage,
  parts: ReadonlyMap<number, CoreMessage>,
): AgentMessage | undefined {
  if (m.role !== "assistant") {
    const core = parts.get(0);
    if (core === undefined) return undefined;
    return withText(m, core.text ?? "");
  }
  if (m.content.length === 0) return parts.has(0) ? m : undefined;
  let same = true;
  const content: typeof m.content = [];
  m.content.forEach((part, k) => {
    const core = parts.get(k);
    if (core === undefined) {
      same = false;
    } else if (part.type !== "text" || core.text === undefined || core.text === part.text) {
      // Tool calls and thoughts go as they were: their arguments and signatures must not change.
      content.push(part);
    } else {
      // The Herder's own words carry no ref tag: seeing one in front of every earlier reply, the
      // model began writing tags itself, some broken (`…>m00205</p>`), and the owner saw them.
      // Tags it wrote before this are taken out of its earlier replies too.
      const text = withoutContextMarks(core.text.replace(LEADING_TAG, ""));
      if (text === part.text) {
        content.push(part);
      } else {
        same = false;
        content.push({ ...part, text });
      }
    }
  });
  if (content.length === 0) return undefined;
  return same ? m : { ...m, content };
}

/** Drops tool results without their call and calls without their result: providers refuse both. */
function paired(messages: AgentMessage[]): AgentMessage[] {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const m of messages) {
    if (m.role === "toolResult") results.add(m.toolCallId);
    if (m.role === "assistant") {
      for (const part of m.content) if (part.type === "toolCall") calls.add(part.id);
    }
  }
  return messages.flatMap((m): AgentMessage[] => {
    if (m.role === "toolResult") return calls.has(m.toolCallId) ? [m] : [];
    if (m.role !== "assistant") return [m];
    const content = m.content.filter((p) => p.type !== "toolCall" || results.has(p.id));
    if (content.length === m.content.length) return [m];
    return content.length === 0 ? [] : [{ ...m, content }];
  });
}

/** Back from the kernel's view to pi messages; summaries and notes become user messages. */
export function fromCore(
  view: readonly CoreMessage[],
  log: readonly AgentMessage[],
): AgentMessage[] {
  const out: AgentMessage[] = [];
  const done = new Set<number>();
  let i = 0;
  while (i < view.length) {
    const first = view[i] as CoreMessage;
    const index = indexOf(first.id);
    if (Number.isNaN(index)) {
      if (first.text !== undefined && first.text !== "") out.push(note(first.text));
      i++;
      continue;
    }
    const parts = new Map<number, CoreMessage>();
    for (; i < view.length; i++) {
      const core = view[i] as CoreMessage;
      if (indexOf(core.id) !== index) break;
      parts.set(Number(ID.exec(core.id)?.[2] ?? 0), core);
    }
    const original = log[index];
    if (original === undefined || done.has(index)) continue;
    done.add(index);
    const rebuilt = rebuild(original, parts);
    if (rebuilt !== undefined) out.push(rebuilt);
  }
  return paired(out);
}

function estimate(view: readonly CoreMessage[]): number {
  let total = 0;
  for (const m of view) total += defaultCountTokens(m.text ?? "") + MESSAGE_OVERHEAD;
  return total;
}

/** The owner's own words in a Herder prompt: without the time line, events or recalled memory. */
function ownerWords(text: string): string {
  const at = text.indexOf(OWNER_LABEL);
  const rest =
    at === -1 ? text.replace(/^\[Now: [^\]]*\]\s*/, "") : text.slice(at + OWNER_LABEL.length);
  const end = rest.indexOf("\n\n[");
  return end === -1 ? rest : rest.slice(0, end);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

/** What a fold without the model's summary says, so the folded part is not a blank. */
export function forcedSummary(log: readonly AgentMessage[], from: number, to: number): string {
  const asks: string[] = [];
  for (let i = from; i <= to; i++) {
    const m = log[i];
    if (m?.role === "user") asks.push(`- ${oneLine(ownerWords(textOf(m.content)), 160)}`);
  }
  return [
    "Folded without a summary because the context was nearly full. Nothing is lost: search_context finds these messages and decompress shows them.",
    ...(asks.length === 0
      ? []
      : ["Owner messages in this part (start of each):", ...asks.slice(-20)]),
  ].join("\n");
}

function cutText(text: string): { text: string; more: number } {
  return text.length > HERDER_CONTEXT_ITEM_TEXT_MAX
    ? {
        text: text.slice(0, HERDER_CONTEXT_ITEM_TEXT_MAX),
        more: text.length - HERDER_CONTEXT_ITEM_TEXT_MAX,
      }
    : { text, more: 0 };
}

function firstLine(text: string, max = 60): string {
  const line = text.replace(LEADING_TAG, "").trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** The first range line of a compress call, e.g. 「m00001–m00243 早期杂务」. */
function foldTopic(content: unknown): string {
  for (const c of content as { type: string; name?: string; arguments?: { content?: unknown } }[]) {
    if (c.type === "toolCall" && c.name === "compress" && typeof c.arguments?.content === "string")
      return firstLine(c.arguments.content);
  }
  return "";
}

/**
 * What a request is made of, by part (ADR 0093): the system prompt with the memory split off, the
 * tool schemas, the owner's messages, the Herder's replies and calls, tool results, and the folded
 * summaries with AgentHerd's notes. Tokens are estimates, counted as the kernel counts them.
 */
export function measureContext(
  messages: readonly AgentMessage[],
  window: number,
  at = new Date(),
): HerderContextSnapshot {
  const parts = Object.fromEntries(HERDER_CONTEXT_PARTS.map((p) => [p, 0])) as HerderContextParts;
  const items: HerderContextItem[] = [];
  const add = (part: HerderContextPart, label: string, text: string, tokens?: number) => {
    const n = tokens ?? defaultCountTokens(text) + MESSAGE_OVERHEAD;
    if (text === "" && n === 0) return;
    parts[part] += n;
    items.push({ part, label, tokens: n, ...cutText(text) });
  };
  for (const m of messages) {
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : textOf(m.content as Content);
      const at = text.search(MEMORY_START);
      if (at < 0) add("system", "系统提示词", text);
      else {
        add("system", "系统提示词", text.slice(0, at).trimEnd());
        add("memory", "记忆", text.slice(at));
      }
      const tools = (m as { toolsAdded?: { name: string }[] }).toolsAdded ?? [];
      for (const t of tools) add("tools", t.name, JSON.stringify(t, null, 2));
    } else if (m.role === "user") {
      const text = textOf(m.content as Content);
      const bare = text.replace(LEADING_TAG, "");
      if (bare.startsWith(FOLD_START))
        add("folds", firstLine(bare.slice(FOLD_START.length)) || "折叠摘要", bare);
      else if (m.timestamp === 0) add("folds", firstLine(bare) || "提示", bare);
      else add("owner", firstLine(bare) || "（图片）", bare);
    } else if (m.role === "assistant") {
      const texts: string[] = [];
      const calls: string[] = [];
      for (const c of m.content as {
        type: string;
        text?: string;
        thinking?: string;
        name?: string;
        arguments?: unknown;
      }[]) {
        if (c.type === "text") texts.push(c.text ?? "");
        else if (c.type === "thinking") texts.push(c.thinking ?? "");
        else if (c.type === "toolCall") {
          calls.push(c.name ?? "");
          texts.push(`${c.name}(${JSON.stringify(c.arguments ?? {})})`);
        }
      }
      // A compress call carries the summary the model reads in its place: it counts as a fold.
      const folding = calls.length > 0 && calls.every((n) => n === "compress");
      const said = firstLine(
        texts.find((t) => t.trim() !== "" && !calls.some((n) => t.startsWith(`${n}(`))) ?? "",
      );
      if (folding) add("folds", foldTopic(m.content) || "折叠摘要", texts.join("\n\n"));
      else {
        const label = calls.length > 0 ? `调用 ${calls.join("、")}` : said || "回复";
        add("herder", label, texts.join("\n\n"));
      }
    } else if (m.role === "toolResult") {
      const r = m as { toolName?: string; content: Content };
      const text = textOf(r.content).replace(LEADING_TAG, "");
      if (r.toolName === "compress") add("folds", "折叠回执", text);
      else add("results", r.toolName ?? "工具结果", text);
    }
  }
  const tokens = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    at: at.toISOString(),
    tokens,
    window,
    foldAt: Math.round(window * FORCED_FOLD_AT),
    parts,
    items,
  };
}

/** The system prompt and tools a request went with, once per change (`herder_prompts`, ADR 0095). */
export function promptOf(view: readonly AgentMessage[]): HerderPromptRecord | undefined {
  const head = view.slice(0, leadingSystem(view));
  if (head.length === 0) return undefined;
  const system = head
    .map((m) => (typeof m.content === "string" ? m.content : textOf(m.content as Content)))
    .join("\n\n");
  const tools = head.flatMap((m) => (m as { toolsAdded?: unknown[] }).toolsAdded ?? []);
  const toolText = tools.map((t) => JSON.stringify(t, null, 2)).join("\n\n");
  const hash = createHash("sha256")
    .update(system)
    .update("\u0000")
    .update(toolText)
    .digest("hex")
    .slice(0, 16);
  return { hash, system, tools, tokens: defaultCountTokens(`${system}\n\n${toolText}`) };
}

/** The system message a kept prompt stands for, to measure or project a request from herd.db. */
export function promptMessage(prompt: Pick<HerderPromptRecord, "system" | "tools">): AgentMessage {
  return {
    role: "system",
    content: prompt.system,
    timestamp: 0,
    toolsAdded: prompt.tools,
  } as AgentMessage;
}

/** First and last position in the log of these engine ids (the opening line is not in the log). */
function seqRange(ids: readonly string[]): { start: number; end: number; count: number } {
  const seqs = new Set(ids.map(indexOf).filter((n) => Number.isFinite(n)));
  if (seqs.size === 0) return { start: 0, end: -1, count: 0 };
  return { start: Math.min(...seqs), end: Math.max(...seqs), count: seqs.size };
}

/** Where each compress call sits in the log, by its call id. */
function callSeqs(log: readonly AgentMessage[]): Map<string, number> {
  const out = new Map<string, number>();
  log.forEach((m, i) => {
    if (m.role !== "assistant") return;
    for (const c of m.content) if (c.type === "toolCall") out.set(c.id, i);
  });
  return out;
}

/**
 * The engine's blocks as `herder_folds` rows (ADR 0095): which fold took which in, how deep each
 * is, whether it is in what the model sees, who made it and where its summary is read.
 */
export function foldRecords(
  state: CompressionState,
  log: readonly AgentMessage[],
  by: ReadonlyMap<string, HerderFoldBy>,
  now = new Date(),
): HerderFoldRecord[] {
  const blocks = state.blocks;
  const parentOf = new Map<string, string>();
  for (const b of blocks) for (const child of b.directBlockIds) parentOf.set(child, b.blockId);
  const byId = new Map(blocks.map((b) => [b.blockId, b]));
  const levels = new Map<string, number>();
  const levelOf = (id: string, seen = new Set<string>()): number => {
    const known = levels.get(id);
    if (known !== undefined) return known;
    const b = byId.get(id);
    if (b === undefined || seen.has(id)) return 1;
    seen.add(id);
    const level = 1 + Math.max(0, ...b.directBlockIds.map((c) => levelOf(c, seen)));
    levels.set(id, level);
    return level;
  };
  const calls = callSeqs(log);
  return blocks.map((b) => {
    const all = seqRange(b.effectiveMessageIds);
    const direct = seqRange(b.directMessageIds);
    const parent = parentOf.get(b.blockId);
    const callSeq = b.compressCallId === undefined ? undefined : calls.get(b.compressCallId);
    return {
      blockId: b.blockId,
      ...(parent === undefined ? {} : { parent }),
      level: levelOf(b.blockId),
      state: b.active ? "active" : parent !== undefined ? "merged" : "opened",
      by: callSeq !== undefined ? "herder" : (by.get(b.blockId) ?? "forced"),
      ...(b.topic === undefined ? {} : { topic: b.topic }),
      summary: b.summary,
      startSeq: all.start,
      endSeq: all.end,
      ...(direct.count === 0 ? {} : { directStart: direct.start, directEnd: direct.end }),
      messages: all.count,
      ...(callSeq === undefined ? {} : { callSeq }),
      tokensBefore: b.compressedTokens,
      tokensAfter: defaultCountTokens(b.summary) + MESSAGE_OVERHEAD,
      createdAt: new Date(b.createdAt).toISOString(),
      updatedAt: now.toISOString(),
      block: b,
    } satisfies HerderFoldRecord;
  });
}

/** A fold row without its save time, to see whether it changed. */
function foldKey(f: HerderFoldRecord): string {
  const { updatedAt: _, ...rest } = f;
  return JSON.stringify(rest);
}

export class HerderContext {
  private readonly core = createCore();
  private readonly prompts: Prompts = resolvePrompts(undefined, { languagePreservation: true });
  private readonly hooks: ContextHooks;
  state: CompressionState;
  /** Tokens of the last request, for the status report. */
  private lastTokens = 0;
  /** What the last request was made of (ADR 0093). */
  snapshot: HerderContextSnapshot | undefined;

  /** Who made the folds AgentHerd made (the Herder's own have a compress call). */
  private readonly foldBy = new Map<string, HerderFoldBy>();
  /** The fold rows as last saved, to write only those that changed. */
  private readonly savedFolds = new Map<string, string>();
  /** Set while folding because the provider said the request was too long. */
  private folding: HerderFoldBy | undefined;
  /** Folds that cut into another were straightened on start (ADR 0095). */
  readonly repaired: string[] = [];

  /**
   * @param saved The engine's bookkeeping; before ADR 0095 it held the folds too.
   * @param folds The folds from `herder_folds`; when there are any, they are the folds.
   */
  constructor(
    hooks: ContextHooks,
    log: readonly AgentMessage[],
    saved?: CompressionState,
    folds: readonly HerderFoldRecord[] = [],
  ) {
    this.hooks = hooks;
    this.state = saved ?? createInitialState();
    if (folds.length > 0) {
      this.state = { ...this.state, blocks: folds.map((f) => f.block as CompressionBlock) };
      for (const f of folds) {
        this.foldBy.set(f.blockId, f.by);
        this.savedFolds.set(f.blockId, foldKey(f));
      }
    } else if (saved === undefined && log.length > 0) {
      // The folds are lost but the compress calls are in the log: replay them.
      try {
        this.state = rebuildCompressionState(this.state, toCore(log), this.config()).state;
      } catch (error) {
        hooks.audit("herder.context.error", {
          during: "rebuild",
          message: (error as Error).message,
        });
      }
    }
    try {
      this.repaired = this.straighten(log);
    } catch (error) {
      hooks.audit("herder.context.error", { during: "repair", message: (error as Error).message });
    }
  }

  /**
   * Folds must nest (ADR 0095): a fold covers whole folds or none of one. A fold made before the
   * check that cuts into an older one keeps only what it folded itself, as long as what the model
   * sees stays exactly the same. @returns the folds that were straightened.
   */
  private straighten(log: readonly AgentMessage[]): string[] {
    const active = this.state.blocks.filter((b) => b.active);
    const fixed = new Map<string, string[]>();
    for (const x of active) {
      let ids = x.effectiveMessageIds;
      for (const y of active) {
        if (y === x || y.createdAt > x.createdAt) continue;
        const inY = new Set(y.effectiveMessageIds);
        const shared = ids.filter((id) => inY.has(id)).length;
        // Inside y, or y whole inside x (then y would not be active): not a cut.
        if (shared === 0 || shared === ids.length || shared === inY.size) continue;
        ids = ids.filter((id) => !inY.has(id));
      }
      if (ids !== x.effectiveMessageIds && ids.length > 0) fixed.set(x.blockId, ids);
    }
    if (fixed.size === 0) return [];
    const blocks = this.state.blocks.map((b) => {
      const ids = fixed.get(b.blockId);
      return ids === undefined ? b : { ...b, effectiveMessageIds: ids };
    });
    const next = { ...this.state, blocks };
    const core = toCore(log);
    const before = JSON.stringify(prune(core, this.state));
    if (JSON.stringify(prune(core, next)) !== before) {
      this.hooks.audit("herder.context.repair-skipped", { blocks: [...fixed.keys()] });
      return [];
    }
    this.state = next;
    const repaired = [...fixed.keys()];
    for (const id of repaired) {
      const r = seqRange(fixed.get(id) ?? []);
      this.hooks.audit("herder.context.repaired", { block: id, from: r.start, to: r.end });
      this.hooks.event?.("fold.repaired", { blockId: id, startSeq: r.start, endSeq: r.end });
    }
    return repaired;
  }

  /** The engine's bookkeeping without the folds, which go to `herder_folds`. */
  bookkeeping(): CompressionState {
    return { ...this.state, blocks: [] };
  }

  /** Fold rows that are new or changed since the last call; the first call returns all of them. */
  changedFolds(log: readonly AgentMessage[], now = new Date()): HerderFoldRecord[] {
    const out: HerderFoldRecord[] = [];
    for (const f of foldRecords(this.state, log, this.foldBy, now)) {
      const key = foldKey(f);
      if (this.savedFolds.get(f.blockId) === key) continue;
      this.savedFolds.set(f.blockId, key);
      out.push(f);
    }
    return out;
  }

  /** Every fold as a `herder_folds` row. */
  folds(log: readonly AgentMessage[]): HerderFoldRecord[] {
    return foldRecords(this.state, log, this.foldBy);
  }

  /**
   * A compress range must take in whole folds or none (ADR 0095). @returns why `startRef–endRef`
   * cuts into an active fold, or undefined when it does not.
   */
  cutsIntoFold(startRef: string, endRef: string): string | undefined {
    const { byRef, byRaw } = this.state.messageRefs;
    const rawStart = byRef[startRef];
    const rawEnd = byRef[endRef];
    if (rawStart === undefined || rawEnd === undefined) return undefined;
    const a = rawStart === "opening" ? -1 : indexOf(rawStart);
    const b = indexOf(rawEnd);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
    const refOf = (seq: number) => byRaw[idOf(seq, 0)] ?? `#${seq}`;
    for (const block of this.state.blocks) {
      if (!block.active) continue;
      const { start: s, end: e, count } = seqRange(block.effectiveMessageIds);
      if (count === 0 || b < s || a > e) continue;
      if ((a <= s && b >= e) || (s <= a && b <= e)) continue;
      return `${startRef}–${endRef} cuts into ${block.blockId} (${refOf(s)}–${refOf(e)}). A fold takes in whole folds or none of one: start at ${refOf(s)} or earlier to take ${block.blockId} in, or keep the range outside ${refOf(s)}–${refOf(e)}.`;
    }
    return undefined;
  }

  /** Records who made the folds that appeared since `before`, and tells the event log. */
  private noteNewFolds(before: ReadonlySet<string>, by: HerderFoldBy): void {
    for (const b of this.state.blocks) {
      if (before.has(b.blockId)) continue;
      if (by !== "herder") this.foldBy.set(b.blockId, by);
      const r = seqRange(b.effectiveMessageIds);
      this.hooks.event?.("fold", {
        blockId: b.blockId,
        by,
        startSeq: r.start,
        endSeq: r.end,
        messages: r.count,
        tokens: b.compressedTokens,
        took: b.directBlockIds,
      });
    }
  }

  /** Compression rules for the system prompt (billion-context's, unchanged). */
  systemPrompt(): string {
    return buildCompressSystemPrompt(this.prompts);
  }

  private config(): Config {
    return defaultConfig(
      workingWindow(this.hooks.contextWindow(), this.hooks.contextCap?.() ?? CONTEXT_WINDOW_MAX),
    );
  }

  private log(): AgentMessage[] {
    const messages = this.hooks.messages();
    return messages.slice(leadingSystem(messages));
  }

  /**
   * Builds what the model sees (`transformContext`): folded parts become their summaries, every
   * message gets a ref tag, and a nudge to fold is added when the context has grown. Should the
   * engine fail, the newest whole turns that fit half the window go instead, so the Herder still
   * answers.
   */
  project(messages: readonly AgentMessage[]): AgentMessage[] {
    let out: AgentMessage[];
    try {
      out = this.view(messages);
    } catch (error) {
      this.hooks.audit("herder.context.error", {
        during: "project",
        message: (error as Error).message,
      });
      out = this.tail(messages);
    }
    try {
      this.snapshot = measureContext(out, this.config().modelContextLimit);
    } catch {
      // Measuring is for the 上下文 tab only.
    }
    return out;
  }

  private tail(messages: readonly AgentMessage[]): AgentMessage[] {
    const lead = leadingSystem(messages);
    const budget = this.config().modelContextLimit * 0.5;
    let start = messages.length;
    let tokens = 0;
    for (let i = messages.length - 1; i >= lead; i--) {
      const m = messages[i] as AgentMessage;
      tokens += defaultCountTokens(JSON.stringify(m)) + MESSAGE_OVERHEAD;
      if (tokens > budget && start < messages.length) break;
      if (m.role === "user") start = i;
    }
    return paired([
      ...messages.slice(0, lead),
      ...messages.slice(start === messages.length ? lead : start),
    ]);
  }

  private view(messages: readonly AgentMessage[]): AgentMessage[] {
    const lead = leadingSystem(messages);
    const head = messages.slice(0, lead);
    const log = messages.slice(lead);
    const core = toCore(log);
    const config = this.config();
    const fixed = defaultCountTokens(JSON.stringify(head));
    const run = () => {
      const tokenCount = fixed + estimate(prune(core, this.state));
      const turn = this.core.processTurn({
        messages: core,
        state: this.state,
        config,
        tokenCount,
        tokenCountSource: "estimate",
      });
      this.state = turn.state;
      return { turn, tokens: fixed + estimate(turn.messages) };
    };
    let { turn, tokens } = run();
    const window = config.modelContextLimit;
    if (
      tokens >= window * FORCED_FOLD_AT &&
      this.fold(core, log, config, tokens - window * FORCED_FOLD_TO)
    ) {
      ({ turn, tokens } = run());
    }
    this.lastTokens = tokens;
    if (turn.terminalEscape !== undefined) {
      this.hooks.audit("herder.context.full", { message: turn.terminalEscape.message });
    }
    const out = [...head, ...fromCore(turn.messages, log)];
    if (turn.nudge?.shouldInject) {
      const text = renderNudgeText(turn.nudge, this.prompts).text;
      if (text !== "") out.push(note(text));
    }
    if (turn.statusLine !== undefined) out.push(note(turn.statusLine));
    return out;
  }

  /**
   * The last resort: folds the oldest unfolded messages with a plain note instead of a summary,
   * whole turns at a time, until about `excess` tokens are folded. The current turn is never
   * folded. @returns whether anything was folded.
   */
  fold(
    core: readonly CoreMessage[],
    log: readonly AgentMessage[],
    config: Config,
    excess: number,
  ): boolean {
    const covered = new Set([...coveredMessageIds(this.state)].map((id) => id.split("#")[0]));
    let end = log.length;
    while (end > 0 && log[end - 1]?.role !== "user") end--;
    end--; // The owner message of the current turn stays, with everything after it.
    const refs = this.state.messageRefs.byRaw;
    const tokensOf = new Map<number, number>();
    for (const c of core) {
      const index = indexOf(c.id);
      tokensOf.set(
        index,
        (tokensOf.get(index) ?? 0) + defaultCountTokens(c.text ?? "") + MESSAGE_OVERHEAD,
      );
    }
    const lastId = (index: number) => {
      const m = log[index];
      const parts = m?.role === "assistant" ? Math.max(m.content.length, 1) : 1;
      return idOf(index, parts - 1);
    };
    const free = (index: number) => index < end && !covered.has(idOf(index, 0));
    const ranges: { startRef: string; endRef: string; summary: string }[] = [];
    let folded = 0;
    for (let i = 0; i < end && folded < excess; ) {
      if (!free(i)) {
        i++;
        continue;
      }
      const from = i;
      let tokens = 0;
      while (free(i) && folded + tokens < excess) {
        tokens += tokensOf.get(i) ?? 0;
        i++;
      }
      // Whole turns: go on to the next owner message so tool calls keep their results.
      while (free(i) && log[i]?.role !== "user") {
        tokens += tokensOf.get(i) ?? 0;
        i++;
      }
      const startRef = refs[idOf(from, 0)];
      const endRef = refs[lastId(i - 1)];
      if (startRef === undefined || endRef === undefined) continue;
      ranges.push({ startRef, endRef, summary: forcedSummary(log, from, i - 1) });
      folded += tokens;
    }
    if (ranges.length === 0) return false;
    const before = new Set(this.state.blocks.map((b) => b.blockId));
    const result = this.core.applyCompression({
      ranges,
      messages: [...core],
      state: this.state,
      // The size floor keeps the model from folding crumbs; a forced fold of a small window is fine.
      config: { ...config, compress: { ...config.compress, minCompressRange: 0 } },
    });
    this.hooks.audit("herder.context.forced-fold", {
      ranges: ranges.map((r) => `${r.startRef}–${r.endRef}`),
      blocks: result.result.blocksCreated,
      errors: result.result.errors,
    });
    if (result.result.blocksCreated === 0) return false;
    this.state = result.state;
    this.noteNewFolds(before, this.folding ?? "forced");
    return true;
  }

  /**
   * After the provider said the request was too long: folds the oldest unfolded messages so about
   * half the window is free. @returns whether anything was folded.
   */
  foldForOverflow(): boolean {
    const messages = this.hooks.messages();
    const lead = leadingSystem(messages);
    const log = messages.slice(lead);
    try {
      const core = toCore(log);
      const config = this.config();
      const tokens =
        defaultCountTokens(JSON.stringify(messages.slice(0, lead))) +
        estimate(prune(core, this.state));
      const excess = Math.max(tokens - config.modelContextLimit * 0.5, tokens / 2);
      this.folding = "overflow";
      return this.fold(core, log, config, excess);
    } catch (error) {
      this.hooks.audit("herder.context.error", {
        during: "overflow",
        message: (error as Error).message,
      });
      return false;
    } finally {
      this.folding = undefined;
    }
  }

  /** Forgets token counts of messages from `from` on, after a failed turn was taken back. */
  rollback(from: number): void {
    const snapshot = { ...this.state.tokenSnapshot };
    for (const [raw, ref] of Object.entries(this.state.messageRefs.byRaw)) {
      if (indexOf(raw) >= from) delete snapshot[ref];
    }
    this.state = { ...this.state, tokenSnapshot: snapshot };
  }

  tools(): AgentTool[] {
    return [this.compressTool(), this.decompressTool(), this.searchTool(), this.statusTool()];
  }

  private compressTool(): AgentTool {
    const fn = COMPRESS_TOOL_OPENAI.function;
    return {
      name: "compress",
      label: "Fold old conversation",
      description: fn.description,
      parameters: obj(
        { content: opt(str({ description: fn.parameters.properties.content.description })) },
        { open: true },
      ),
      execute: async (callId: string, args: Record<string, unknown>) => {
        const parsed = parseCompressArgs(args, { callId });
        if (parsed.ranges.length === 0) {
          throw new Error(
            "no ranges found: content must hold blocks that each start with a 'mNNNNN–mNNNNN topic' line",
          );
        }
        // Folds nest (ADR 0095): a range that cuts into a fold is refused before the engine sees it.
        const cuts: string[] = [];
        const ranges = parsed.ranges.filter((r) => {
          const cut = this.cutsIntoFold(r.startRef, r.endRef);
          if (cut !== undefined) cuts.push(cut);
          return cut === undefined;
        });
        if (ranges.length === 0) {
          this.hooks.audit("herder.context.compress", {
            ranges: parsed.ranges.map((x) => `${x.startRef}–${x.endRef}`),
            blocks: 0,
            errors: cuts,
          });
          throw new Error(cuts.join("\n"));
        }
        const before = new Set(this.state.blocks.map((b) => b.blockId));
        const result = this.core.applyCompression({
          ranges: ranges.map((r) => ({ ...r, compressCallId: callId })),
          messages: toCore(this.log()),
          state: this.state,
          config: this.config(),
        });
        const r = result.result;
        this.hooks.audit("herder.context.compress", {
          ranges: parsed.ranges.map((x) => `${x.startRef}–${x.endRef}`),
          blocks: r.blocksCreated,
          tokens: r.tokensCompressed,
          errors: [...cuts, ...r.errors],
        });
        const notes = [
          ...cuts.map((c) => `Not compressed: ${c}`),
          ...[...r.warnings, ...(r.notes ?? [])].map((n) => `Note: ${n}`),
        ];
        if (r.blocksCreated === 0) {
          // Already folded or among the newest messages: a receipt, so the model does not retry.
          if (r.noop === true) {
            return ok(
              [
                "[Compression no-op: nothing in these ranges needed folding. They are already folded or among the newest messages, which stay as they are.]",
                ...notes,
              ].join("\n"),
            );
          }
          throw new Error([...r.errors, ...notes].join("; ") || "nothing was compressed");
        }
        this.state = result.state;
        this.noteNewFolds(before, "herder");
        const lines = [
          `Compressed ${r.blocksCreated} block(s), about ${r.tokensCompressed} tokens folded.`,
          ...r.errors.map((e) => `Not compressed: ${e}`),
          ...notes,
        ];
        return ok(lines.join("\n"));
      },
    } as AgentTool;
  }

  private decompressTool(): AgentTool {
    return {
      name: "decompress",
      label: "Read a folded part",
      description:
        "Shows the content of a compressed block without unfolding it. Use when you need exact details lost in compression. By default restores one tier up (nested blocks stay as their summaries); full:true shows every original message.",
      parameters: obj(
        {
          blockId: str({ description: "Block ID to decompress (e.g. b5)" }),
          full: opt(bool({ description: "Restore all the way to original messages" })),
        },
        { open: true },
      ),
      execute: async (_id: string, args: { blockId: string; full?: boolean }) => {
        const blockId = parseBlockIdArg(args.blockId);
        const block = this.state.blocks.find((b) => b.blockId === blockId);
        if (block === undefined) {
          const known = this.state.blocks.filter((b) => b.active).map((b) => b.blockId);
          throw new Error(`no block ${args.blockId}; active blocks: ${known.join(", ") || "none"}`);
        }
        const { text, count } = collectBlockContent(this.state, block, toCore(this.log()), {
          full: args.full === true,
        });
        const cut =
          text.length > DECOMPRESS_MAX_CHARS
            ? `${text.slice(0, DECOMPRESS_MAX_CHARS)}\n… (cut; search_context finds the rest)`
            : text;
        const topic = block.topic === undefined ? "" : ` — ${block.topic}`;
        return ok(
          `${block.blockId}${topic}, ${count} message(s). It stays folded; compress this result again when done.\n\n${cut}`,
        );
      },
    } as AgentTool;
  }

  private searchTool(): AgentTool {
    return {
      name: "search_context",
      label: "Search folded conversation",
      description:
        "Search through compressed block summaries and the messages folded into them by keyword. Use BEFORE decompressing to find the right block.",
      parameters: obj(
        {
          query: str({ description: "Search query" }),
          limit: opt(int({ description: "Max results (default 5)" })),
        },
        { open: true },
      ),
      execute: async (_id: string, args: { query: string; limit?: number }) => {
        const core = toCore(this.log());
        const byId = new Map(core.map((c) => [c.id, c]));
        const folded: MessageInput[] = [];
        for (const block of this.state.blocks) {
          if (!block.active) continue;
          for (const id of block.effectiveMessageIds) {
            const m = byId.get(id);
            const ref = this.state.messageRefs.byRaw[id];
            if (m === undefined || ref === undefined || m.role === "system" || !m.text) continue;
            folded.push({ ref, text: m.text, role: m.role, blockId: block.blockId });
          }
        }
        const results = searchBlocks(
          [...blockDocs(this.state), ...messageDocs(folded)],
          args.query,
          {
            limit: args.limit ?? 5,
          },
        );
        if (results.length === 0) return ok(`nothing found for "${args.query}"`);
        return ok(
          results
            .map((r) =>
              r.kind === "block"
                ? `${r.blockId} (block) ${r.title}: ${r.preview}`
                : `${r.ref} in ${r.blockId} (${r.role}): ${r.preview}`,
            )
            .join("\n"),
        );
      },
    } as AgentTool;
  }

  private statusTool(): AgentTool {
    return {
      name: "acp_status",
      label: "Context status",
      description:
        "Show context usage and compressible ranges. No args = overview; pass scope/view/tool/sort/limit for targeted listings.",
      parameters: obj(
        {
          scope: opt(
            str({
              description:
                '"uncompressed": history outside active blocks; "compressed": block ledger; omit = default overview',
            }),
          ),
          view: opt(
            str({ description: '"messages" for a per-message listing; "ranges" is the default' }),
          ),
          tool: opt(
            str({ description: 'With view:"messages": only list results of this tool name' }),
          ),
          sort: opt(
            str({ description: 'With view:"messages": order by "size", "time", "tool", or "age"' }),
          ),
          limit: opt(int({ description: "Max entries to list" })),
        },
        { open: true },
      ),
      execute: async (
        _id: string,
        args: { scope?: string; view?: string; tool?: string; sort?: string; limit?: number },
      ) => {
        const config = this.config();
        const core = toCore(this.log());
        const status = this.core.status(this.state, this.lastTokens, config);
        const usage = Math.round(status.contextUsage * 100);
        const head = `Context: about ${status.tokenCount} of ${status.modelContextLimit} tokens (${usage}%), ${status.activeBlocks} active block(s).`;
        const { scope, view, sort } = args;
        const report = buildStatusReport(this.state, core, defaultCountTokens, {
          ...(scope === "compressed" || scope === "uncompressed" ? { scope } : {}),
          ...(view === "messages" || view === "ranges" ? { view } : {}),
          ...(args.tool === undefined ? {} : { tool: args.tool }),
          ...(sort === "size" || sort === "time" || sort === "tool" || sort === "age"
            ? { sort }
            : {}),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          config,
          originalMessages: core,
        });
        return ok(`${head}\n${report}`);
      },
    } as AgentTool;
  }
}
