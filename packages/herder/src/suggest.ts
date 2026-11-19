// What the owner might say next, shown in the pet's empty input (ADR 0084).
//
// The way Codex tried it (openai/codex#24126): the same model, the same system prompt and the same
// conversation the Herder's last request carried, plus one instruction at the end. The prefix is the
// last request's, so the provider's prompt cache answers most of it. Nothing of this is kept in the
// conversation. The model may stay silent; an answer that does not read like the owner's own words
// is dropped (rules from Codex and from the DSH plugin @studyzy/dsh-suggest-prompt).

import type { StreamFn } from "@agentherd/herder-loop";
import type { Locale } from "@agentherd/protocol";
import { type Api, type Message, type Model, normalizeContext } from "@earendil-works/pi-ai";

/** The longest answer asked for: a short line. */
export const SUGGEST_MAX_TOKENS = 32;
/** After this the suggestion is given up. */
export const SUGGEST_TIMEOUT_MS = 8000;
/** The longest suggestion shown, in characters. */
export const SUGGEST_MAX_CHARS = 40;

const ZH_INSTRUCTION = `[建议模式：猜主人接下来会对主管说什么。这一条不是主人说的，你的回答也不会发给任何人。]

先看主人最近说的话和他最初的要求。
你要猜的是主人自己会打的那句话，不是你觉得他该做什么。能看出他想达到什么，就给朝那里走的下一步。
检验：主人看到会不会想「我正要打这句」？

不要出：
- 评价（「不错」「谢谢」）
- 问句
- 主管的口吻（「我来…」「让我…」）
- 主人没提过的新点子
- 好几句话

下一步不明显，就什么都不回。
格式：一句话，2 到 20 个字，照主人平时的说法。只回这句话本身：不加引号，不加解释，不调用工具。`;

const EN_INSTRUCTION = `[SUGGESTION MODE: guess what the owner will say to the Herder next. This line is not from the owner and your answer goes to no one.]

First look at the owner's recent messages and what they asked for in the first place.
Predict what THEY would type, not what you think they should do. If you can see what they are after, offer the next step towards it.
THE TEST: would they think "I was just about to type that"?

Never suggest:
- Evaluative words ("looks good", "thanks")
- Questions
- The Herder's voice ("Let me…", "I'll…")
- New ideas they did not ask about
- Several sentences

Stay silent if the next step is not obvious.
Format: 2 to 12 words, in the owner's own style. Reply with only the suggestion: no quotes, no explanation, no tool calls.`;

/** The instruction added after the conversation. */
export function suggestInstruction(locale: Locale): string {
  return locale === "en" ? EN_INSTRUCTION : ZH_INSTRUCTION;
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const QUOTES: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
];
const META = new Set([
  "done",
  "none",
  "silence",
  "stay silent",
  "no suggestion",
  "nothing to suggest",
  "无",
  "没有",
  "无建议",
  "没有建议",
  "暂无建议",
  "不需要",
]);
const META_START = ["suggestion:", "next prompt:", "建议：", "建议:", "下一句：", "主人："];
const EVALUATIVE = [
  "looks good",
  "thanks",
  "thank you",
  "great",
  "谢谢",
  "多谢",
  "不错",
  "很好",
  "辛苦",
  "太棒",
];
const HERDER_VOICE = [
  "let me",
  "i'll",
  "i will",
  "here's",
  "here is",
  "sure,",
  "我来",
  "我帮你",
  "让我",
  "我可以",
  "我建议",
  "我会",
  "好的，我",
  "好的,我",
];
/** One word is a real next message only when it is one of these. */
const ONE_WORD = new Set([
  "yes",
  "ok",
  "okay",
  "sure",
  "continue",
  "go",
  "好",
  "行",
  "嗯",
  "可以",
  "继续",
  "好的",
]);

/**
 * The model's answer as one line the owner could send as it is, or undefined when it is not one:
 * empty, several lines, a question, formatting, a label, praise, the Herder's own voice, too long
 * or a lone word that is not a plain yes.
 */
export function filterSuggestion(raw: string): string | undefined {
  let text = raw.trim();
  if (text === "" || /[\n\r\t]/.test(text)) return undefined;
  for (const [open, close] of QUOTES) {
    if (text.length > 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, -close.length).trim();
      break;
    }
  }
  text = text
    .replace(/\s+/g, " ")
    .replace(/[。.！!]+$/u, "")
    .trim();
  if (text === "") return undefined;
  if (/[?？`*#|]/.test(text) || /^[-•]\s/.test(text) || /^\d+[.、)]\s?/.test(text))
    return undefined;
  if (/^[([（【].*[)\]）】]$/u.test(text)) return undefined;
  const lower = text.toLowerCase();
  if (META.has(lower) || META_START.some((p) => lower.startsWith(p))) return undefined;
  if (EVALUATIVE.some((p) => lower.startsWith(p))) return undefined;
  if (HERDER_VOICE.some((p) => lower.startsWith(p))) return undefined;
  const chars = Array.from(text).length;
  if (chars > SUGGEST_MAX_CHARS) return undefined;
  if (CJK.test(text)) {
    if (chars < 2 && !ONE_WORD.has(text)) return undefined;
  } else {
    const words = text.split(" ").length;
    if (words > 12 || (words < 2 && !ONE_WORD.has(lower))) return undefined;
  }
  return text;
}

export interface SuggestRequest {
  streamFn: StreamFn;
  model: Model<Api>;
  apiKey?: string;
  /** The conversation exactly as the last request carried it, then the reply it got. */
  messages: Message[];
  locale: Locale;
  signal: AbortSignal;
  timeoutMs?: number;
}

/**
 * One hidden request for the next message: no tools may run, at most {@link SUGGEST_MAX_TOKENS}
 * tokens, given up after the timeout. Undefined when there is nothing worth showing; never throws.
 */
export async function sampleSuggestion(req: SuggestRequest): Promise<string | undefined> {
  if (req.signal.aborted) return undefined;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), req.timeoutMs ?? SUGGEST_TIMEOUT_MS);
  const signal = AbortSignal.any([req.signal, timeout.signal]);
  try {
    const context = normalizeContext({
      messages: [
        ...req.messages,
        {
          role: "user",
          content: [{ type: "text", text: suggestInstruction(req.locale) }],
          timestamp: Date.now(),
        },
      ],
    });
    const stream = await req.streamFn(req.model, context, {
      ...(req.apiKey === undefined ? {} : { apiKey: req.apiKey }),
      maxTokens: SUGGEST_MAX_TOKENS,
      toolChoice: "none",
      signal,
    });
    const done = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("suggestion given up")), {
        once: true,
      });
    });
    const message = await Promise.race([stream.result(), done]);
    if (signal.aborted || message.stopReason !== "stop") return undefined;
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    return filterSuggestion(text);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
