// How each kind of mailbox source is looked at (ADR 0099, 0100). Code only: a look fetches what
// is there now and returns it as letters with ids; the mailbox keeps the ids it has seen and passes
// only new ones on, so nothing here decides what is new and no model runs. Timers are not looked
// at; the mailbox runs them itself.

import { spawn } from "node:child_process";
import {
  type AppTools,
  fetchMail,
  type GhRun,
  type IntakeKind,
  type Letter,
  type MailboxCheck,
  type MailboxSource,
  type SocialSource,
  searchItems,
  searchSince,
} from "@agentherd/core";

export const MAILBOX_FETCH_MS = 20_000;
export const MAILBOX_FETCH_MAX = 2_000_000;
export const SCRIPT_TIMEOUT_MS = 60_000;
export const SCRIPT_OUTPUT_MAX = 1_000_000;
/** How much of an issue's or a post's text a letter carries. */
export const LETTER_TEXT = 800;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AgentHerd";

export type ScriptRun = (
  command: string,
  input: string,
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<string>;

export interface MailboxSourcesOptions {
  gh: GhRun;
  home: string;
  fetchFn?: typeof fetch;
  script?: ScriptRun;
  env?: () => NodeJS.ProcessEnv;
  /** The owner's connected apps (Gmail through Composio), for mail sources. */
  apps?: () => AppTools | undefined;
  /** The owner's 小红书/知乎 accounts, for social sources. */
  socials?: () => readonly SocialSource[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cut(value: string, max = LETTER_TEXT): string {
  const t = value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function wordsOf(config: Record<string, unknown>): string[] {
  const raw = config.words;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,，、]/) : [];
  return list.map((w) => String(w).trim().toLowerCase()).filter((w) => w !== "");
}

/** Keeps letters that mention one of the words (all of them when there are none). */
export function withWords(letters: Letter[], words: readonly string[]): Letter[] {
  if (words.length === 0) return letters;
  return letters.filter((l) => {
    const hay = `${l.title}\n${l.body ?? ""}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
}

// --- GitHub ------------------------------------------------------------------------------------

interface GhIssue {
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  user?: { login?: string };
  pull_request?: unknown;
  labels?: ({ name?: string } | string)[];
}

interface GhRelease {
  id?: number;
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string;
  draft?: boolean;
  author?: { login?: string };
}

function parseJson<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${what} did not answer with JSON`);
  }
}

/** New issues, pull requests and releases of one repository, newest first. */
export async function githubLetters(gh: GhRun, config: Record<string, unknown>): Promise<Letter[]> {
  const repo = text(config.repo).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("github needs repo as owner/name");
  const what =
    Array.isArray(config.what) && config.what.length > 0
      ? config.what.map(String)
      : ["issues", "releases"];
  const letters: Letter[] = [];
  if (what.includes("issues") || what.includes("prs")) {
    const raw = await gh([
      "api",
      `repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=30`,
    ]);
    for (const i of parseJson<GhIssue[]>(raw, "GitHub")) {
      if (typeof i.number !== "number") continue;
      const pr = i.pull_request !== undefined;
      if (pr ? !what.includes("prs") : !what.includes("issues")) continue;
      const labels = (i.labels ?? [])
        .map((l) => (typeof l === "string" ? l : text(l.name)))
        .filter((l) => l !== "");
      const by = i.user?.login === undefined ? "" : `@${i.user.login}`;
      const head = [by, labels.length === 0 ? "" : `标签：${labels.join("、")}`]
        .filter((s) => s !== "")
        .join(" · ");
      letters.push({
        id: `${pr ? "pr" : "issue"}:${i.number}`,
        title: `${pr ? "PR " : ""}#${i.number} ${text(i.title)}`,
        body: cut([head, text(i.body)].filter((s) => s !== "").join("\n")),
        ...(i.html_url === undefined ? {} : { link: i.html_url }),
      });
    }
  }
  if (what.includes("releases")) {
    const raw = await gh(["api", `repos/${repo}/releases?per_page=10`]);
    for (const r of parseJson<GhRelease[]>(raw, "GitHub")) {
      if (typeof r.id !== "number" || r.draft === true) continue;
      const name = text(r.name).trim();
      const tag = text(r.tag_name);
      letters.push({
        id: `release:${r.id}`,
        title: `发布 ${tag}${name !== "" && name !== tag ? ` ${name}` : ""}`,
        body: cut(text(r.body)),
        ...(r.html_url === undefined ? {} : { link: r.html_url }),
      });
    }
  }
  return withWords(letters, wordsOf(config));
}

// --- RSS and Atom ------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X"))
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return ENTITIES[code.toLowerCase()] ?? all;
    });
}

function plain(html: string): string {
  return decode(
    decode(html)
      .replace(/<(br|\/p|\/li|\/h\d)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m?.[1];
}

function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1] ?? "");
  const pick =
    links.find((a) => /rel=["']alternate["']/i.test(a)) ??
    links.find((a) => !/rel=/i.test(a)) ??
    links[0];
  return pick === undefined ? undefined : /href=["']([^"']+)["']/i.exec(pick)?.[1];
}

/** The items of an RSS or Atom feed as letters, in the feed's order. */
export function feedLetters(xml: string): Letter[] {
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const letters: Letter[] = [];
  for (const block of items) {
    const title = plain(tag(block, "title") ?? "");
    const rawLink = tag(block, "link");
    const link = decode(
      rawLink !== undefined && rawLink.trim() !== "" ? rawLink.trim() : (atomLink(block) ?? ""),
    ).trim();
    const id = decode((tag(block, "guid") ?? tag(block, "id") ?? "").trim()) || link || title;
    if (id === "") continue;
    const body = plain(
      tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content") ?? "",
    );
    letters.push({
      id,
      title: title === "" ? "(no title)" : title,
      body: cut(body),
      ...(/^https?:\/\//.test(link) ? { link } : {}),
    });
  }
  return letters;
}

async function fetchText(fetchFn: typeof fetch, url: string, accept: string): Promise<string> {
  const res = await fetchFn(url, {
    headers: { "user-agent": UA, accept },
    signal: AbortSignal.timeout(MAILBOX_FETCH_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  const body = await res.text();
  if (body.length > MAILBOX_FETCH_MAX) return body.slice(0, MAILBOX_FETCH_MAX);
  return body;
}

// --- Hacker News -------------------------------------------------------------------------------

interface HnHit {
  objectID?: string;
  title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  author?: string;
}

/** New Hacker News stories with the words, optionally only those with enough points. */
export async function hnLetters(
  fetchFn: typeof fetch,
  config: Record<string, unknown>,
): Promise<Letter[]> {
  const words = text(config.words).trim();
  if (words === "") throw new Error("hn needs words to search");
  const points = typeof config.points === "number" && config.points > 0 ? config.points : 0;
  const params = new URLSearchParams({ query: words, tags: "story", hitsPerPage: "30" });
  if (points > 0) params.set("numericFilters", `points>=${points}`);
  const raw = await fetchText(
    fetchFn,
    `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`,
    "application/json",
  );
  const hits = parseJson<{ hits?: HnHit[] }>(raw, "Hacker News").hits ?? [];
  return hits
    .filter((h) => typeof h.objectID === "string")
    .map((h) => {
      const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
      return {
        id: `hn:${h.objectID}`,
        title: text(h.title),
        body: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments · discussion: ${discussion}`,
        link: typeof h.url === "string" && h.url !== "" ? h.url : discussion,
      };
    });
}

// --- GitHub work for the owner (ADR 0052, 0100) ------------------------------------------------

const WORK_KINDS: Record<string, IntakeKind> = { assigned: "issues", reviews: "reviews" };

/** Open issues assigned to the owner and pull requests asking for their review; id is the address. */
export async function workLetters(gh: GhRun, config: Record<string, unknown>): Promise<Letter[]> {
  const what = (Array.isArray(config.what) ? config.what.map(String) : []).filter(
    (w) => WORK_KINDS[w] !== undefined,
  );
  if (what.length === 0) throw new Error('work needs what: ["assigned"] or ["reviews"]');
  const repo = text(config.repo).trim();
  const label = text(config.label).trim();
  const letters: Letter[] = [];
  for (const w of what) {
    const kind = WORK_KINDS[w] as IntakeKind;
    const items = await searchItems(gh, {
      kind,
      ...(repo === "" ? {} : { repo }),
      ...(label === "" ? {} : { label }),
    });
    for (const item of items) {
      letters.push({
        id: item.url,
        title: `${kind === "issues" ? "派给你的 issue" : "等你评审的 PR"} ${item.repo} #${item.number} ${item.title}`,
        link: item.url,
      });
    }
  }
  return letters;
}

// --- Gmail (ADR 0048, 0100) ---------------------------------------------------------------------

/** New mail matching the search since the source was made; id is Gmail's. */
export async function mailLetters(
  apps: AppTools | undefined,
  source: MailboxSource,
): Promise<Letter[]> {
  const query = text(source.config.query).trim();
  if (query === "") throw new Error("mail needs a Gmail search as query");
  if (apps === undefined) throw new Error("Gmail is not connected; connect it in 应用连接");
  const found = await fetchMail(apps, searchSince(query, source.createdAt));
  return found
    .filter((m) => m.at === "" || m.at >= source.createdAt)
    .map((m) => ({
      id: m.id,
      title: `${m.sender}：${m.subject}`,
      body: cut(m.preview),
      ...(/^https?:\/\//.test(m.url) ? { link: m.url } : {}),
    }));
}

// --- 小红书 and 知乎 notices (ADR 0058, 0100) -------------------------------------------------------

/**
 * Comments, answers and @ on the owner's account; id is the platform's. A platform that is not
 * signed in is skipped (not a look). After the first look the notices are read only when the
 * platform says something is unread, because reading them may mark them read.
 */
export async function socialLetters(
  socials: readonly SocialSource[],
  source: MailboxSource,
): Promise<{ letters: Letter[]; skipped?: boolean }> {
  const platform = text(source.config.platform);
  const account = socials.find((s) => s.platform === platform);
  if (account === undefined || !account.ready()) return { letters: [], skipped: true };
  if (source.started && ((await account.unread()).mentions ?? 0) === 0) return { letters: [] };
  const notices = await account.notices("mentions");
  return {
    letters: notices.map((n) => ({
      id: n.id,
      title: `${n.who}${n.on === undefined || n.on === "" ? "" : `在「${cut(n.on, 40)}」`}：${cut(n.text, 120)}`,
      body: cut(n.text),
      ...(n.url === undefined ? {} : { link: n.url }),
    })),
  };
}

// --- A script the owner (or a task) wrote ------------------------------------------------------

/** Runs a command through the shell, feeding `input` on stdin, and returns what it printed. */
export const runScript: ScriptRun = (command, input, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      env: opts.env,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`the script ran longer than ${opts.timeoutMs / 1000} s`)));
    }, opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      if (out.length > SCRIPT_OUTPUT_MAX) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("the script printed more than 1 MB")));
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString("utf8")).slice(-2000);
    });
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) =>
      finish(() => {
        if (code === 0) resolve(out);
        else {
          const tail = err.trim().split("\n").slice(-3).join(" ");
          reject(new Error(`the script exited with ${code}${tail === "" ? "" : `: ${tail}`}`));
        }
      }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });

/** Reads a script's answer: {"letters": [...], "state": ...}, or just the list of letters. */
export function scriptAnswer(out: string): { letters: Letter[]; state?: unknown } {
  const t = out.trim();
  if (t === "") return { letters: [] };
  let value: unknown;
  try {
    value = JSON.parse(t);
  } catch {
    throw new Error(`the script printed no JSON: ${t.slice(0, 120)}`);
  }
  if (Array.isArray(value)) return { letters: value as Letter[] };
  if (value !== null && typeof value === "object") {
    const v = value as { letters?: unknown; state?: unknown };
    if (v.letters !== undefined && !Array.isArray(v.letters))
      throw new Error("letters must be a list");
    return {
      letters: (v.letters as Letter[] | undefined) ?? [],
      ...("state" in v ? { state: v.state } : {}),
    };
  }
  throw new Error('the script must print {"letters": [...], "state": ...}');
}

// --- All of them -------------------------------------------------------------------------------

export function mailboxCheck(opts: MailboxSourcesOptions): MailboxCheck {
  const fetchFn = opts.fetchFn ?? fetch;
  const script = opts.script ?? runScript;
  return async (source: MailboxSource, state: unknown) => {
    const config = source.config;
    switch (source.kind) {
      case "github":
        return { letters: await githubLetters(opts.gh, config) };
      case "rss": {
        const url = text(config.url).trim();
        if (!/^https?:\/\/\S+$/.test(url)) throw new Error("rss needs the feed's url");
        const xml = await fetchText(
          fetchFn,
          url,
          "application/rss+xml, application/atom+xml, application/xml, text/xml",
        );
        return { letters: withWords(feedLetters(xml), wordsOf(config)) };
      }
      case "hn":
        return { letters: await hnLetters(fetchFn, config) };
      case "work":
        return { letters: await workLetters(opts.gh, config) };
      case "mail":
        return { letters: await mailLetters(opts.apps?.(), source) };
      case "social":
        return socialLetters(opts.socials?.() ?? [], source);
      case "script": {
        const command = text(config.command).trim();
        if (command === "") throw new Error("script needs a command");
        const out = await script(command, `${JSON.stringify({ state: state ?? null })}\n`, {
          cwd: text(config.cwd).trim() || opts.home,
          env: opts.env?.() ?? process.env,
          timeoutMs: SCRIPT_TIMEOUT_MS,
        });
        return scriptAnswer(out);
      }
      default:
        return { letters: [] };
    }
  };
}
