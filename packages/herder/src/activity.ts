// The Herder's action log for the app (主管 › 行动记录): its saved conversation (herder_log,
// ADR 0045) read back as turns, each with what started it, every tool it called and what it said.
// Nothing new is recorded for this; the conversation already holds all of it.

import { withoutContextMarks } from "./context.ts";
import { OWNER_LABEL, quietReply } from "./prompt.ts";

/** What started a turn. */
export type ActivityTrigger =
  | "owner"
  | "answer"
  | "task"
  | "scheduled"
  | "intake"
  /** Only notices (task reports, PR news…), from before 2026-11. */
  | "notice"
  | "other";

export interface ActivityStep {
  tool: string;
  args: Record<string, unknown>;
  /** The tool's answer, as the Herder saw it. */
  result: string;
  error: boolean;
  ms?: number;
}

export interface ActivityTurn {
  /** ISO time the turn started. */
  at: string;
  trigger: ActivityTrigger;
  /** The words that started it: the owner's message, their answer, the task's name… */
  text: string;
  /** For an answer, the question it answered. */
  question?: string;
  /** Notices that came along with the turn (task reports, PR news…), one line each. */
  events: string[];
  /** It came before AgentHerd restarted (ADR 0062). */
  resumed: boolean;
  steps: ActivityStep[];
  /** What the Herder wrote last; "" when it said nothing. */
  reply: string;
  /** It chose to say nothing ([quiet]). */
  quiet: boolean;
  model?: string;
}

/** Longest tool answer kept per step; the log keeps the whole of it. */
export const ACTIVITY_RESULT_MAX = 4000;

interface LogMessage {
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  model?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
  durationMs?: unknown;
}

interface Block {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
}

function blocks(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

function textOf(content: unknown): string {
  return blocks(content)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function iso(ms: unknown): string {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function cut(text: string): string {
  return text.length <= ACTIVITY_RESULT_MAX ? text : `${text.slice(0, ACTIVITY_RESULT_MAX)}…`;
}

/** The text inside `<<<agent … agent>>>`, or the text as it is. */
function unquote(text: string): string {
  const m = /<<<agent\n([\s\S]*?)\nagent>>>/.exec(text);
  return (m?.[1] ?? text).trim();
}

/** Parts of a turn's prompt (see prompt.ts and herder.ts runJob). */
function readPrompt(raw: string): Omit<ActivityTurn, "at" | "steps" | "reply" | "quiet"> {
  let rest = withoutContextMarks(raw).trim();
  // [Now: …] is always the first line.
  if (rest.startsWith("[Now:")) rest = rest.slice(rest.indexOf("\n") + 1).trimStart();
  let resumed = false;
  if (rest.startsWith("[This came at ")) {
    resumed = true;
    const end = rest.indexOf("]\n");
    rest = end < 0 ? "" : rest.slice(end + 2).trimStart();
  }
  const events: string[] = [];
  // "[Already sent to the owner…]", "[Not pushed to the owner…]", or before 2026-11 "[Events…]".
  while (/^\[(Already sent to the owner|Not pushed to the owner|Events)[^\]\n]*\]\n- /.test(rest)) {
    // Each notice is "- what: about", maybe followed by quoted words that can hold blank lines;
    // the block ends at the first blank line outside a quote.
    const lines = rest.split("\n");
    let i = 1;
    let inQuote = false;
    let current: string[] | undefined;
    const flush = () => {
      if (current === undefined) return;
      const [head = "", ...body] = current;
      const words = unquote(body.join("\n"));
      events.push(words === "" ? head : `${head} — ${words}`);
      current = undefined;
    };
    for (; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!inQuote && line.trim() === "") break;
      if (!inQuote && line.startsWith("- ")) {
        flush();
        current = [line.slice(2)];
        continue;
      }
      if (line === "<<<agent") inQuote = true;
      else if (line === "agent>>>") inQuote = false;
      current?.push(line);
    }
    flush();
    rest = lines
      .slice(i + 1)
      .join("\n")
      .trimStart();
  }
  const base = { events, resumed };
  // Before 2026-11 a turn could be only notices, ending with a line on what to do with them.
  if (events.length > 0 && (rest === "" || rest.startsWith("Use notify only"))) {
    return { ...base, trigger: "notice", text: "" };
  }
  if (rest.startsWith(OWNER_LABEL)) {
    // The owner's words, then lines AgentHerd adds: images, the memory recall.
    const body = rest.slice(OWNER_LABEL.length).trimStart();
    const recall = body.indexOf("\n\n[记忆召回");
    return { ...base, trigger: "owner", text: (recall < 0 ? body : body.slice(0, recall)).trim() };
  }
  const answer = /^The owner answered your question\.\nQuestion: ([\s\S]*?)\nAnswer: ([^\n]*)/.exec(
    rest,
  );
  if (answer !== null) {
    return {
      ...base,
      trigger: "answer",
      text: (answer[2] ?? "").trim(),
      question: (answer[1] ?? "").trim(),
    };
  }
  if (rest.startsWith("[Task result")) {
    const head = /^Task [0-9a-f]+ "([\s\S]*?)" ([^\n]*)\.$/m.exec(rest);
    return { ...base, trigger: "task", text: head?.[1] ?? "" };
  }
  if (rest.startsWith("[Scheduled:")) {
    const about = /^\[Scheduled: "([\s\S]*?)", set by the owner/.exec(rest);
    return { ...base, trigger: "scheduled", text: about?.[1] ?? "" };
  }
  if (rest.startsWith("A new-work watch") || rest.startsWith("The owner tapped 「开任务」")) {
    return { ...base, trigger: "intake", text: unquote(rest) };
  }
  return { ...base, trigger: "other", text: rest.split("\n")[0] ?? "" };
}

/**
 * Every user message in the saved conversation is a turn's prompt; the opening line and fold
 * summaries are only in what the model is shown, not in the log.
 */
function startsTurn(m: LogMessage): boolean {
  return m.role === "user" && !textOf(m.content).startsWith("[Start of the conversation");
}

/**
 * The Herder's turns, oldest first, read from its saved conversation. Tool calls are matched to
 * their answers; context tools (fold, search) are steps like any other.
 */
export function activityTurns(log: readonly unknown[]): ActivityTurn[] {
  const turns: ActivityTurn[] = [];
  let turn: ActivityTurn | undefined;
  const pending = new Map<string, ActivityStep>();
  for (const item of log) {
    if (item === null || typeof item !== "object") continue;
    const m = item as LogMessage;
    if (startsTurn(m)) {
      turn = {
        ...readPrompt(textOf(m.content)),
        at: iso(m.timestamp),
        steps: [],
        reply: "",
        quiet: false,
      };
      turns.push(turn);
      pending.clear();
      continue;
    }
    if (turn === undefined) continue;
    if (m.role === "assistant") {
      if (typeof m.model === "string") turn.model = m.model;
      for (const b of blocks(m.content)) {
        if (b.type !== "toolCall" || typeof b.name !== "string") continue;
        const step: ActivityStep = {
          tool: b.name,
          args:
            b.arguments !== null && typeof b.arguments === "object"
              ? (b.arguments as Record<string, unknown>)
              : {},
          result: "",
          error: false,
        };
        turn.steps.push(step);
        if (typeof b.id === "string") pending.set(b.id, step);
      }
      const text = withoutContextMarks(textOf(m.content)).trim();
      if (text !== "") {
        turn.quiet = quietReply(text);
        turn.reply = turn.quiet ? "" : text;
      }
    } else if (m.role === "toolResult") {
      const step = typeof m.toolCallId === "string" ? pending.get(m.toolCallId) : undefined;
      if (step === undefined) continue;
      step.result = cut(textOf(m.content));
      step.error = m.isError === true;
      if (typeof m.durationMs === "number") step.ms = m.durationMs;
    }
  }
  return turns;
}
