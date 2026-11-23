// The Herder's mailbox tools (ADR 0099, 0100): sources — feeds, repositories, GitHub work, mail,
// 小红书/知乎 notices and timers — are added, changed and removed only because the owner asked;
// letters are filed only in the turn that brought them.

import {
  describeWhen,
  type HerderHost,
  LETTER_FATES,
  type LetterFate,
  MAILBOX_KINDS,
  type MailboxAct,
  type MailboxKind,
  type MailboxPatch,
  type MailboxSource,
  type MailboxSourceInput,
  type ScheduleWhen,
} from "@agentherd/core";
import type { AgentTool, AgentToolResult } from "@agentherd/herder-loop";
import { arr, bool, int, num, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { TurnContext } from "./tools.ts";

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function ownerAsked(turn: () => TurnContext, what: string): void {
  const kind = turn().kind;
  if (kind !== "owner" && kind !== "answer") throw new Error(`only the owner can ${what}`);
}

const KIND_HELP = [
  'github: a repository, config {repo: "owner/name", what: ["issues","prs","releases"] (default issues and releases), words?}.',
  "rss: a feed, {url, words?}.",
  'hn: Hacker News stories, {words: "agent memory", points?: 50}.',
  'work: GitHub work waiting for the owner, {what: ["assigned"] (issues assigned to them) or ["reviews"] (pull requests asking for their review), repo?, label?}.',
  'mail: the owner\'s Gmail, {query: a Gmail search such as "from:li@uni.edu"}.',
  "social: comments and @ on the owner's 小红书/知乎 account, {platform: xiaohongshu|zhihu}.",
  'script: {command, cwd?}; the command reads {"state": …} on stdin and prints {"letters":[{"id","title","body?","link?"}],"state":…}; an empty list means nothing new.',
  "timer: something you do at set times, {when: kind daily (at HH:MM, days?), every (hours) or once (at YYYY-MM-DD HH:MM)}, and note is the whole job.",
].join(" ");

const whenSchema = obj({
  kind: oneOf(["daily", "every", "once"] as const, {
    description:
      "daily: at a time on every day or on some weekdays; every: every N hours from now; once: one time at a date and time",
  }),
  at: opt(
    str({
      description:
        'daily: "HH:MM"; once: "YYYY-MM-DD HH:MM". The owner\'s local time, the one in [Now: …].',
    }),
  ),
  days: opt(
    arr(int({ minimum: 1, maximum: 7 }), {
      description: "daily only: weekdays, 1 Monday … 7 Sunday; leave out for every day",
    }),
  ),
  hours: opt(num({ description: "every only: hours between runs, at least 1" })),
});

const configSchema = obj({
  repo: opt(str({ description: "github and work: owner/name." })),
  what: opt(arr(oneOf(["issues", "prs", "releases", "assigned", "reviews"] as const))),
  url: opt(str({ description: "rss: the feed's address." })),
  words: opt(
    str({
      description:
        "Words: github and rss keep only items with one of them (comma separated); hn searches them.",
    }),
  ),
  points: opt(int({ minimum: 0, description: "hn: only stories with at least this many points." })),
  label: opt(str({ description: "work: only items with this label." })),
  query: opt(str({ description: "mail: a Gmail search." })),
  platform: opt(oneOf(["xiaohongshu", "zhihu"] as const)),
  command: opt(str({ description: "script: the command line to run." })),
  cwd: opt(str({ description: "script: the folder to run it in." })),
  when: opt(whenSchema),
});

const actSchema = opt(
  oneOf(["sort", "offer", "auto"] as const, {
    description:
      "What happens to a new letter. sort (default; work defaults to offer): you weigh it and tell the owner, keep it for the digest or only note it. offer: the owner gets each one with 「开任务 / 忽略」. auto: you start work on it as the owner said; it starts on a trial run that starts nothing.",
  }),
);

const trialSchema = opt(
  bool({
    description:
      "auto only: false ends the trial run, only when the owner says so (「放开」「以后直接开」). Leave out otherwise.",
  }),
);

const addSchema = obj({
  kind: oneOf(MAILBOX_KINDS, { description: KIND_HELP }),
  name: str({ description: "A short name the owner sees, e.g. 「codex 的新 issue」." }),
  note: str({
    description:
      "One sentence, in the owner's words, of what they care about here; you read it with every letter. For a timer: what you do at the time, complete on its own (the project, what to do or check, when to stay quiet, e.g. 「没有新的就不用说」).",
  }),
  config: opt(configSchema),
  everyMinutes: opt(
    int({
      minimum: 1,
      description: "How often to look; leave out for the default. Not for a timer.",
    }),
  ),
  act: actSchema,
  trial: trialSchema,
});

const changeSchema = obj({
  source: str({ description: "Id (or its first characters) or name of the source." }),
  paused: opt(bool()),
  name: opt(str()),
  note: opt(str()),
  everyMinutes: opt(int({ minimum: 1 })),
  when: opt(whenSchema),
  act: actSchema,
  trial: trialSchema,
});

const removeSchema = obj({ source: str({ description: "Id (or its first characters) or name." }) });

const fileSchema = obj({
  letters: arr(
    obj({
      id: int({ description: "The letter's number." }),
      fate: oneOf(LETTER_FATES, {
        description:
          "now: tell the owner now; digest: the morning digest; noted: not worth their time.",
      }),
      why: str({ description: "A short reason, in the owner's language." }),
    }),
    { minItems: 1 },
  ),
});

type WhenArgs = { kind: string; at?: string; days?: number[]; hours?: number };

type ConfigArgs = {
  repo?: string;
  what?: string[];
  url?: string;
  words?: string;
  points?: number;
  label?: string;
  query?: string;
  platform?: string;
  command?: string;
  cwd?: string;
  when?: WhenArgs;
};

/** The tool's `kind`/`at`/`days`/`hours` as a timer's time. */
export function whenFrom(args: WhenArgs): ScheduleWhen {
  if (args.kind === "every") {
    if (args.hours === undefined) throw new Error("every needs hours");
    return { kind: "every", hours: args.hours };
  }
  if (args.at === undefined) throw new Error(`${args.kind} needs at`);
  if (args.kind === "once") return { kind: "once", at: args.at };
  if (args.kind === "daily") {
    return { kind: "daily", at: args.at, ...(args.days === undefined ? {} : { days: args.days }) };
  }
  throw new Error('when.kind must be "daily", "every" or "once"');
}

function repoOf(text: string | undefined): string {
  return (text ?? "")
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

/** The config a kind needs, checked so a source that cannot work is refused when it is added. */
export function sourceConfig(kind: MailboxKind, args: ConfigArgs = {}): Record<string, unknown> {
  const words = (args.words ?? "")
    .split(/[,，、]/)
    .map((w) => w.trim())
    .filter((w) => w !== "");
  if (kind === "github") {
    const repo = repoOf(args.repo);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("github needs repo as owner/name");
    const what = (args.what ?? []).filter((w) => ["issues", "prs", "releases"].includes(w));
    return {
      repo,
      what: what.length > 0 ? what : ["issues", "releases"],
      ...(words.length === 0 ? {} : { words }),
    };
  }
  if (kind === "rss") {
    const url = (args.url ?? "").trim();
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("rss needs the feed's url");
    return { url, ...(words.length === 0 ? {} : { words }) };
  }
  if (kind === "hn") {
    const text = (args.words ?? "").trim();
    if (text === "") throw new Error("hn needs words to search");
    return { words: text, ...(args.points === undefined ? {} : { points: args.points }) };
  }
  if (kind === "work") {
    const what = (args.what ?? []).filter((w) => w === "assigned" || w === "reviews");
    if (what.length === 0) throw new Error('work needs what: ["assigned"] or ["reviews"]');
    const repo = repoOf(args.repo);
    if (repo !== "" && !/^[\w.-]+(\/[\w.-]+)?$/.test(repo)) {
      throw new Error("work's repo is owner/name");
    }
    const label = (args.label ?? "").trim();
    return {
      what: [...new Set(what)],
      ...(repo === "" ? {} : { repo }),
      ...(label === "" ? {} : { label }),
    };
  }
  if (kind === "mail") {
    const query = (args.query ?? "").trim();
    if (query === "") throw new Error("mail needs a Gmail search as query");
    return { query };
  }
  if (kind === "social") {
    if (args.platform !== "xiaohongshu" && args.platform !== "zhihu") {
      throw new Error("social needs platform xiaohongshu or zhihu");
    }
    return { platform: args.platform };
  }
  if (kind === "script") {
    const command = (args.command ?? "").trim();
    if (command === "") throw new Error("script needs a command");
    return { command, ...(args.cwd === undefined ? {} : { cwd: args.cwd }) };
  }
  if (kind === "timer") {
    if (args.when === undefined) throw new Error("a timer needs when");
    return { when: whenFrom(args.when) };
  }
  return {};
}

/** What a source does with a new letter, from the tool's act and trial. */
export function actFrom(
  kind: MailboxKind,
  act: "sort" | "offer" | "auto" | undefined,
  trial: boolean | undefined,
  old?: MailboxAct,
): MailboxAct | undefined {
  if (kind === "timer") return undefined;
  if (act === undefined) {
    if (trial === false && old === "trial") return "auto";
    return old === undefined ? (kind === "work" ? "offer" : "sort") : undefined;
  }
  if (act === "auto") {
    if (trial === false) return "auto";
    // A source that already runs by itself stays that way unless the owner asked again.
    return old === "auto" ? "auto" : "trial";
  }
  return act;
}

const ACT_WORDS: Record<MailboxAct, string> = {
  sort: "you sort its letters",
  offer: "each letter is offered with 「开任务 / 忽略」",
  trial: "auto, on a trial run",
  auto: "auto",
};

export function sourceLine(s: MailboxSource): string {
  const state = s.paused
    ? "paused"
    : s.lastError !== undefined
      ? `failing (${s.lastError})`
      : s.started
        ? `ok, last ${s.kind === "timer" ? "run" : "look"} ${s.lastRunAt?.slice(0, 16) ?? "-"}`
        : "first look pending";
  if (s.kind === "timer") {
    const when = s.config.when as ScheduleWhen | undefined;
    return `- ${s.id.slice(0, 8)} "${s.name}" (timer, ${when === undefined ? "?" : describeWhen(when)}, ${state}) — ${s.note.replace(/\s+/g, " ").slice(0, 200)}`;
  }
  const trials = s.act === "trial" ? `, ${s.trials} item(s) so far` : "";
  return `- ${s.id.slice(0, 8)} "${s.name}" (${s.kind}, every ${s.everyMinutes} min, ${ACT_WORDS[s.act]}${trials}, ${s.letters} letters, ${state}) ${JSON.stringify(s.config)} — ${s.note}`;
}

function oneSource(host: HerderHost, query: string): MailboxSource {
  const q = query.trim();
  const all = host.mailboxSources?.() ?? [];
  const found = all.filter((s) => s.id.startsWith(q) || s.name === q || s.name.includes(q));
  const exact = found.filter((s) => s.id.startsWith(q) || s.name === q);
  const pick = exact.length === 1 ? exact : found;
  const only = pick[0];
  if (pick.length === 1 && only !== undefined) return only;
  if (pick.length === 0) throw new Error(`no mailbox source matches "${query}"; see mailbox_list`);
  throw new Error(
    `several sources match "${query}": ${pick.map((s) => `${s.id.slice(0, 8)} "${s.name}"`).join(", ")}`,
  );
}

const TOLD = "; tell the owner in one short line what you set up, in their words";

export function mailboxTools(host: HerderHost, turn: () => TurnContext): AgentTool[] {
  const tools: unknown[] = [];
  if (host.fileLetters !== undefined) {
    const file = host.fileLetters;
    tools.push({
      name: "letters_file",
      label: "File letters",
      description:
        "Only in a turn that brought letters: records for each letter now, digest or noted, with a short reason. Every letter once.",
      parameters: fileSchema,
      execute: async (
        _id: string,
        args: { letters: { id: number; fate: LetterFate; why: string }[] },
      ) => {
        const t = turn();
        if (t.kind !== "letters")
          throw new Error("letters are filed only in the turn that brought them");
        const unknown = file(args.letters);
        for (const l of args.letters) if (!unknown.includes(l.id)) t.filed?.add(l.id);
        const counts = LETTER_FATES.map(
          (f) =>
            `${f} ${args.letters.filter((l) => l.fate === f && !unknown.includes(l.id)).length}`,
        ).join(", ");
        return ok(
          unknown.length === 0
            ? `filed (${counts})`
            : `filed (${counts}); no letter ${unknown.join(", ")}`,
        );
      },
    });
  }
  if (host.addMailboxSource !== undefined && host.mailboxSources !== undefined) {
    const add = host.addMailboxSource;
    tools.push(
      {
        name: "mailbox_list",
        label: "List mailbox sources",
        description:
          "The owner's mailbox sources and timers: what each looks at or does, how often, and whether it works.",
        parameters: obj({}),
        execute: async () => {
          const all = host.mailboxSources?.() ?? [];
          return ok(all.length === 0 ? "no sources yet" : all.map(sourceLine).join("\n"));
        },
      },
      {
        name: "mailbox_add",
        label: "Add a mailbox source",
        description: `Only when the owner asks you to keep an eye on something (「盯一下 openai/codex 的新 issue」「导师来邮件提醒我」「有人 @ 我告诉我」), to offer or start GitHub work for them, or to do something at set times or later (「每天早上 9 点看看 PI-Desktop 有没有新 issue」「明天下午三点提醒我交周报」). Code looks at a source on its own clock, its first look only remembers what is there, and new letters come to you; a timer's note comes back to you as a turn at its time. ${KIND_HELP} Never add one they did not ask for.`,
        parameters: addSchema,
        execute: async (
          _id: string,
          args: {
            kind: MailboxKind;
            name: string;
            note: string;
            config?: ConfigArgs;
            everyMinutes?: number;
            act?: "sort" | "offer" | "auto";
            trial?: boolean;
          },
        ) => {
          ownerAsked(turn, "add mailbox sources");
          const act = actFrom(args.kind, args.act, args.trial);
          const input: MailboxSourceInput = {
            kind: args.kind,
            name: args.name,
            note: args.note,
            config: sourceConfig(args.kind, args.config),
            by: "herder",
            ...(args.everyMinutes === undefined || args.kind === "timer"
              ? {}
              : { everyMinutes: args.everyMinutes }),
            ...(act === undefined ? {} : { act }),
          };
          const s = add(input);
          return ok(`added ${sourceLine(s)}${TOLD}`);
        },
      },
      {
        name: "mailbox_try",
        label: "Try a mailbox source",
        description:
          "Looks at a source once without keeping it: what it would bring now. Use it before adding a script, or to check a repository, feed, search or account works. For a timer it says when it would run.",
        parameters: addSchema,
        execute: async (
          _id: string,
          args: { kind: MailboxKind; name: string; note: string; config?: ConfigArgs },
        ) => {
          if (host.tryMailboxSource === undefined) throw new Error("sources cannot be tried here");
          const letters = await host.tryMailboxSource({
            kind: args.kind,
            name: args.name,
            note: args.note,
            config: sourceConfig(args.kind, args.config),
          });
          if (args.kind === "timer") {
            return ok(`it would run ${letters[0]?.body ?? "?"}`);
          }
          if (letters.length === 0) return ok("it works; nothing there right now");
          return ok(
            `it works; it would see ${letters.length} letter(s) now (the first look only remembers them):\n${letters
              .slice(0, 8)
              .map((l) => `- ${l.title}${l.link === undefined ? "" : ` ${l.link}`}`)
              .join("\n")}`,
          );
        },
      },
      {
        name: "mailbox_change",
        label: "Change a mailbox source",
        description:
          "Pauses, resumes or renames a source or timer, or changes its note, how often it is looked at, a timer's time, or what happens to its letters, when the owner asks.",
        parameters: changeSchema,
        execute: async (
          _id: string,
          args: {
            source: string;
            paused?: boolean;
            name?: string;
            note?: string;
            everyMinutes?: number;
            when?: WhenArgs;
            act?: "sort" | "offer" | "auto";
            trial?: boolean;
          },
        ) => {
          ownerAsked(turn, "change mailbox sources");
          const s = oneSource(host, args.source);
          if (args.when !== undefined && s.kind !== "timer") {
            throw new Error("only a timer has a time; change everyMinutes for other sources");
          }
          const act =
            args.act === undefined && args.trial === undefined
              ? undefined
              : actFrom(s.kind, args.act, args.trial, s.act);
          const patch: MailboxPatch = {
            ...(args.paused === undefined ? {} : { paused: args.paused }),
            ...(args.name === undefined ? {} : { name: args.name }),
            ...(args.note === undefined ? {} : { note: args.note }),
            ...(args.everyMinutes === undefined || s.kind === "timer"
              ? {}
              : { everyMinutes: args.everyMinutes }),
            ...(args.when === undefined
              ? {}
              : { config: { ...s.config, when: whenFrom(args.when) } }),
            ...(act === undefined ? {} : { act }),
          };
          const next = host.changeMailboxSource?.(s.id, patch);
          if (next === undefined) throw new Error("sources cannot be changed here");
          return ok(`changed ${sourceLine(next)}${TOLD}`);
        },
      },
      {
        name: "mailbox_remove",
        label: "Remove a mailbox source",
        description: "Removes a source or timer and its letters when the owner no longer wants it.",
        parameters: removeSchema,
        execute: async (_id: string, args: { source: string }) => {
          ownerAsked(turn, "remove mailbox sources");
          const s = oneSource(host, args.source);
          host.removeMailboxSource?.(s.id);
          return ok(`removed "${s.name}"`);
        },
      },
    );
  }
  return tools as AgentTool[];
}
