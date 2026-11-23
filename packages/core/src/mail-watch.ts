// Mail through the owner's Gmail on Composio (ADR 0048). Since ADR 0100 a mailbox source of kind
// `mail` does the looking; this file only reads messages for a Gmail search.
import type { AppTools } from "./mcp-gateway.ts";
import { MULTI_EXECUTE } from "./mcp-gateway.ts";

const FETCH_MAX = 10;
const PREVIEW_MAX = 300;
const FETCH_SLUG = "GMAIL_FETCH_EMAILS";

/** One message as AgentHerd tells it. */
export interface MailMessage {
  id: string;
  sender: string;
  subject: string;
  preview: string;
  url: string;
  at: string;
}

// Mail previews pad with invisible characters so clients show less of the next line.
const INVISIBLE =
  /\u034f|[\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202f\u2060-\u206f\u3164\ufeff\uffa0]/g;

function tidy(text: string, max: number): string {
  const t = text.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** "Name <a@b.c>" → "Name"; a bare address stays. */
function senderName(sender: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(sender);
  if (m === null) return sender.trim();
  return (m[1] ?? "").trim() || (m[2] ?? "").trim();
}

interface FetchedMessage {
  messageId?: string;
  sender?: string;
  subject?: string;
  messageTimestamp?: string;
  display_url?: string;
  preview?: { body?: string };
}

/** Runs one Gmail search through Composio; newest first, as Gmail answers. */
export async function fetchMail(
  apps: AppTools,
  query: string,
  max = FETCH_MAX,
): Promise<MailMessage[]> {
  const result = (await apps.call(MULTI_EXECUTE, {
    tools: [
      {
        tool_slug: FETCH_SLUG,
        arguments: { query, max_results: max, include_payload: false, verbose: false },
      },
    ],
  })) as { content?: { type?: string; text?: string }[]; isError?: boolean };
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError === true) throw new Error(tidy(text, 300) || "Gmail search failed");
  let body: {
    successful?: boolean;
    error?: unknown;
    data?: {
      results?: {
        response?: {
          successful?: boolean;
          error?: unknown;
          data?: { messages?: FetchedMessage[] };
        };
      }[];
    };
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(`unexpected Gmail answer: ${tidy(text, 200)}`);
  }
  const response = body.data?.results?.[0]?.response;
  if (body.successful === false || response === undefined || response.successful === false) {
    const why = response?.error ?? body.error ?? "Gmail search failed";
    throw new Error(typeof why === "string" ? why : JSON.stringify(why));
  }
  return (response.data?.messages ?? [])
    .filter((m) => typeof m.messageId === "string" && m.messageId !== "")
    .map((m) => ({
      id: m.messageId as string,
      sender: senderName(m.sender ?? ""),
      subject: tidy(m.subject ?? "", PREVIEW_MAX) || "(no subject)",
      preview: tidy(m.preview?.body ?? "", PREVIEW_MAX),
      url: m.display_url ?? `https://mail.google.com/mail/u/0/#all/${m.messageId}`,
      at: m.messageTimestamp ?? "",
    }));
}

/** Gmail's `after:` takes seconds since 1970. */
export function searchSince(query: string, createdAt: string): string {
  const after = `after:${Math.floor(Date.parse(createdAt) / 1000)}`;
  return query.trim() === "" ? `in:inbox ${after}` : `(${query.trim()}) ${after}`;
}
