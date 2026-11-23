// What herd.db keeps next to each message of the Herder's conversation (ADR 0095): who it is
// from, what kind of message it is, its round and its size, so the 上下文 tab can read it from the
// database without parsing every message.

/** What started a round: the owner, a task's result, things the owner was already told, … */
export type HerderRoundKind =
  | "owner"
  | "task"
  | "event"
  | "answer"
  | "scheduled"
  | "intake"
  | "other";

/** A round's kind for the message that starts it; replies, tool calls and results otherwise. */
export type HerderMessageKind = HerderRoundKind | "reply" | "call" | "result";

export interface HerderMessageFacts {
  role: string;
  kind: HerderMessageKind;
  /** Tool names of a call (joined with ","), or the tool of a result. */
  tool?: string;
  /** When it was made, if the message says. */
  at?: string;
  /** Estimated tokens, counted as the context engine counts them. */
  tokens: number;
  chars: number;
  /** For a message that starts a round: one line saying what it is about. */
  title?: string;
}

/** Shown in place of a round's title when nothing better is found. */
const TITLE_MAX = 80;
/** Per piece of a message, as the context engine adds. */
const PIECE_OVERHEAD = 4;
const OWNER_LABEL = "[Owner's message]";

/**
 * Tokens of a text, the way the context engine (packages/context-kernel `defaultCountTokens`)
 * counts them: CJK characters one each, the rest a quarter. Kept the same by a test.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjk?.length ?? 0;
  return cjkCount + Math.ceil((text.length - cjkCount) / 4);
}

interface Piece {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
}

function pieces(content: unknown): Piece[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as Piece[]) : [];
}

function textOf(content: unknown): string {
  return pieces(content)
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n");
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line;
}

/** The round a user message starts, and a title for it, from the labels the Herder's prompts use. */
export function roundOf(text: string): { kind: HerderRoundKind; title: string } {
  const lines = text.split("\n");
  if (lines[0]?.startsWith("[Now:")) lines.shift();
  const body = lines.join("\n").trim();
  const first = lines[0] ?? "";
  const after = (label: string) => body.slice(body.indexOf(label) + label.length).trim();
  if (first.startsWith(OWNER_LABEL)) {
    const words = after(OWNER_LABEL).split("\n\n[")[0] ?? "";
    return { kind: "owner", title: oneLine(words) || "（图片）" };
  }
  if (first.startsWith("[Task result")) {
    const task = /^Task \S+ "(.*)" (.*)\.$/m.exec(body);
    return {
      kind: "task",
      title: oneLine(task === null ? (lines[1] ?? "") : `「${task[1]}」${task[2]}`),
    };
  }
  if (first.startsWith("[Letters") || first.startsWith("[Mailbox digest")) {
    // ADR 0099: the head line says how many letters came.
    return { kind: "event", title: oneLine(first.replace(/^\[[^\]]*\]\s*/, "信箱：")) };
  }
  if (
    first.startsWith("[Already sent to the owner") ||
    first.startsWith("[Not pushed") ||
    first.startsWith("[Events")
  ) {
    return { kind: "event", title: oneLine((lines[1] ?? "").replace(/^- /, "")) };
  }
  if (first.startsWith("The owner answered your question")) {
    const answer = /^Answer: (.*)$/m.exec(body)?.[1] ?? "";
    return { kind: "answer", title: oneLine(answer) };
  }
  if (first.startsWith("[Scheduled:")) {
    const about = /^\[Scheduled: "(.*?)"/.exec(first)?.[1] ?? "";
    return { kind: "scheduled", title: oneLine(about) };
  }
  if (first.startsWith("A new-work watch") || first.startsWith("The owner tapped")) {
    return { kind: "intake", title: oneLine(lines[1] ?? first) };
  }
  return { kind: "other", title: oneLine(first) };
}

/** What a stored message is, read from the message itself. */
export function herderMessageFacts(message: unknown): HerderMessageFacts {
  const m = (message ?? {}) as {
    role?: string;
    content?: unknown;
    timestamp?: unknown;
    toolName?: string;
  };
  const role = typeof m.role === "string" ? m.role : "other";
  const at =
    typeof m.timestamp === "number" && m.timestamp > 0
      ? new Date(m.timestamp).toISOString()
      : undefined;
  const sized = (texts: string[]) => ({
    tokens: texts.reduce((n, t) => n + countTokens(t) + PIECE_OVERHEAD, 0),
    chars: texts.reduce((n, t) => n + t.length, 0),
  });
  const base = { role, ...(at === undefined ? {} : { at }) };
  if (role === "user") {
    const text = textOf(m.content);
    const round = roundOf(text);
    return { ...base, kind: round.kind, title: round.title, ...sized([text]) };
  }
  if (role === "toolResult") {
    return {
      ...base,
      kind: "result",
      ...(m.toolName === undefined ? {} : { tool: m.toolName }),
      ...sized([textOf(m.content)]),
    };
  }
  if (role === "assistant") {
    const parts = pieces(m.content);
    const calls = parts.filter((p) => p.type === "toolCall").map((p) => p.name ?? "");
    const texts = parts.map((p) =>
      p.type === "toolCall"
        ? JSON.stringify(p.arguments ?? {})
        : p.type === "thinking"
          ? (p.thinking ?? "")
          : (p.text ?? ""),
    );
    return {
      ...base,
      kind: calls.length > 0 ? "call" : "reply",
      ...(calls.length > 0 ? { tool: calls.join(",") } : {}),
      ...sized(texts.length === 0 ? [""] : texts),
    };
  }
  return { ...base, kind: "other", ...sized([textOf(m.content)]) };
}
