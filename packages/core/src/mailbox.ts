// The Herder's mailbox (ADR 0099, 0100). Every outside source and every timer is a source here: a
// GitHub repository, a feed, words on Hacker News, a script of the owner's, GitHub work waiting for
// the owner, mail, notices on 小红书/知乎, and timers. Code looks at each source on its own clock and
// compares with what it saw before; the model is not called for that. The first look only
// remembers what is there. What comes after goes where the source says: to the Herder, who decides
// for each letter (tell the owner now, keep it for the morning digest, or only note it); to the
// owner as an offer with 「开任务 / 忽略」; or straight to the Herder to start work, when the owner
// said so. A timer hands its words to the Herder at its time. Letters are other people's words: the
// Herder reads them as data, never as the owner's instructions.

import { randomUUID } from "node:crypto";
import type { AskView, MessageRef } from "@agentherd/protocol";
import type { Timer } from "./clock.ts";
import { type HerdContext, say } from "./herd-context.ts";
import {
  LETTER_FATES,
  type Letter,
  type LetterFate,
  MAILBOX_ACTS,
  MAILBOX_KINDS,
  type MailboxAct,
  type MailboxKind,
  type MailboxSource,
  type StoredLetter,
} from "./mailbox-store.ts";
import { checkWhen, describeWhen, nextRun, type Schedule, type ScheduleWhen } from "./schedules.ts";

/** Sources at most. */
export const MAILBOX_SOURCES_MAX = 50;
/** How often AgentHerd looks whether a source is due. */
export const MAILBOX_TICK_MS = 60_000;
/** The shortest time between two looks at a source, per kind (minutes). A timer runs by `when`. */
export const MAILBOX_EVERY_MIN: Record<MailboxKind, number> = {
  github: 5,
  rss: 15,
  hn: 15,
  script: 1,
  timer: 0,
  work: 5,
  mail: 3,
  social: 20,
};
/** Minutes between two looks unless the owner said otherwise. */
export const MAILBOX_EVERY_DEFAULT: Record<MailboxKind, number> = {
  github: 10,
  rss: 60,
  hn: 60,
  script: 30,
  timer: 0,
  work: 5,
  mail: 5,
  social: 20,
};
/** A look at 小红书/知乎 moves up to this many minutes either way, so looks do not tick. */
export const SOCIAL_JITTER_MINUTES = 5;
/** Letters one look delivers; the rest are only remembered as seen. */
export const LETTERS_PER_LOOK = 20;
/** Letters given to the Herder in one go. */
export const LETTERS_PER_DELIVERY = 30;
/** Letters in one digest. */
export const LETTERS_PER_DIGEST = 60;
export const LETTER_TITLE_MAX = 160;
export const LETTER_BODY_MAX = 1200;
/** What a source keeps between two looks, as JSON. */
export const MAILBOX_STATE_MAX = 64_000;
/** The digest of letters the Herder kept goes out at this local hour. */
export const DIGEST_HOUR = 9;
/** After this many failed looks in a row the owner is told, once. */
export const MAILBOX_FAILS_TOLD = 3;
/** Buttons of an offer are this target followed by the letter's number. */
export const MAILBOX_TARGET = "mailbox:";
const NAME_MAX = 40;
const NOTE_MAX = 300;
/** A timer's note is what the Herder does at the time, so it may be longer. */
const TIMER_NOTE_MAX = 2000;
const LINE_BODY_MAX = 600;
const DIGEST_STATE_KEY = "mailbox.digest";

export type { Letter, LetterFate, MailboxAct, MailboxKind, MailboxSource, StoredLetter };
export { LETTER_FATES, MAILBOX_ACTS, MAILBOX_KINDS };

/** What a look found, and what the source keeps for the next look. */
export interface CheckResult {
  letters: Letter[];
  state?: unknown;
  /** Nothing could be read this time (the account is not signed in): not a look, not a failure. */
  skipped?: boolean;
}

/** Looks at one source. `state` is what the last look kept (undefined on the first). */
export type MailboxCheck = (source: MailboxSource, state: unknown) => Promise<CheckResult>;

export interface MailboxSourceInput {
  kind: MailboxKind;
  name: string;
  note?: string;
  /** Kind-specific settings; a timer has `when`. */
  config?: Record<string, unknown>;
  everyMinutes?: number;
  act?: MailboxAct;
  by?: "owner" | "herder";
}

export interface MailboxPatch {
  name?: string;
  note?: string;
  config?: Record<string, unknown>;
  everyMinutes?: number;
  paused?: boolean;
  act?: MailboxAct;
}

/** Letters of one source as the Herder gets them. */
export interface LetterGroup {
  sourceId: string;
  name: string;
  kind: MailboxKind;
  note: string;
  letters: { id: number; title: string; body: string; link?: string }[];
}

/** `new`: letters that just came. `digest`: the ones the Herder kept for the morning digest. */
export interface LetterDelivery {
  kind: "new" | "digest";
  groups: LetterGroup[];
}

export interface MailboxOptions {
  check: MailboxCheck;
  /** Called when sources or letters changed, for the app. */
  changed?: () => void;
  tickMs?: number;
  digestHour?: number;
}

/** What a timer keeps: when it runs next and when it last ran. */
interface TimerState {
  nextAt?: string;
  lastAt?: string;
}

function tidy(text: string, max: number): string {
  const t = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** A source's letters made safe to keep: an id, a title on one line, a web link only. */
export function cleanLetters(letters: readonly Letter[]): Letter[] {
  const out: Letter[] = [];
  const ids = new Set<string>();
  for (const l of letters) {
    if (l === null || typeof l !== "object") continue;
    const id = typeof l.id === "string" || typeof l.id === "number" ? String(l.id).trim() : "";
    if (id === "" || id.length > 300 || ids.has(id)) continue;
    const title = tidy(String(l.title ?? "").replace(/\s+/g, " "), LETTER_TITLE_MAX);
    const body = tidy(typeof l.body === "string" ? l.body : "", LETTER_BODY_MAX);
    const link = typeof l.link === "string" && /^https?:\/\/\S+$/.test(l.link) ? l.link : undefined;
    ids.add(id);
    out.push({
      id,
      title: title === "" ? "(no title)" : title,
      ...(body === "" ? {} : { body }),
      ...(link === undefined ? {} : { link }),
    });
  }
  return out;
}

/** A timer's `when` from its config, checked. */
export function timerWhen(config: Record<string, unknown>): ScheduleWhen {
  const when = config.when;
  if (when === null || typeof when !== "object") {
    throw new Error(
      "a timer needs when: daily at HH:MM (maybe on some days), every N hours, or once",
    );
  }
  return checkWhen(when as ScheduleWhen);
}

/** One letter in one line (and its text below), for the Herder starting or weighing work. */
export function letterLine(
  name: string,
  letter: Pick<StoredLetter, "title" | "body" | "link">,
): string {
  const body = letter.body.trim();
  return `${name}: ${letter.title}${letter.link === undefined ? "" : ` ${letter.link}`}${
    body === "" ? "" : `\n${tidy(body, LINE_BODY_MAX)}`
  }`;
}

function groupsOf(
  letters: readonly StoredLetter[],
  source: (id: string) => MailboxSource | undefined,
): LetterGroup[] {
  const groups = new Map<string, LetterGroup>();
  for (const l of letters) {
    const s = source(l.sourceId);
    if (s === undefined) continue;
    const g = groups.get(s.id) ?? {
      sourceId: s.id,
      name: s.name,
      kind: s.kind,
      note: s.note,
      letters: [],
    };
    g.letters.push({
      id: l.id,
      title: l.title,
      body: l.body,
      ...(l.link === undefined ? {} : { link: l.link }),
    });
    groups.set(s.id, g);
  }
  return [...groups.values()];
}

/** A number from 0 to n-1 that stays the same for the same text. */
function spread(text: string, n: number): number {
  let h = 0;
  for (const c of text) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return h % n;
}

export class Mailbox {
  private readonly ctx: HerdContext;
  private readonly opts: MailboxOptions;
  private timer: Timer | undefined;
  private stopped = true;
  private chain: Promise<void> = Promise.resolve();
  private readonly busy = new Set<string>();

  constructor(ctx: HerdContext, opts: MailboxOptions) {
    this.ctx = ctx;
    this.opts = opts;
  }

  private get store() {
    return this.ctx.store.mailbox;
  }

  private now(): string {
    return this.ctx.clock.now().toISOString();
  }

  start(): void {
    this.stopped = false;
    this.schedule(5_000);
  }

  stop(): void {
    this.stopped = true;
    this.timer?.cancel();
    this.timer = undefined;
  }

  private schedule(ms = this.opts.tickMs ?? MAILBOX_TICK_MS): void {
    this.timer?.cancel();
    if (this.stopped) return;
    this.timer = this.ctx.clock.after(ms, () => {
      void this.tick().finally(() => this.schedule());
    });
  }

  list(): MailboxSource[] {
    return this.store.sources();
  }

  letters(limit = 200, sourceId?: string): StoredLetter[] {
    return this.store.letters(limit, sourceId);
  }

  /** When a timer runs next (ISO); undefined for other kinds or a paused timer. */
  nextAt(source: MailboxSource): string | undefined {
    if (source.kind !== "timer" || source.paused) return undefined;
    return (this.store.memory(source.id).state as TimerState | undefined)?.nextAt;
  }

  /** The owner (or the Herder, when the owner asked) adds a source. Its first look runs soon. */
  add(input: MailboxSourceInput): MailboxSource {
    if (!(MAILBOX_KINDS as readonly string[]).includes(input.kind)) {
      throw new Error(`kind must be one of ${MAILBOX_KINDS.join(", ")}`);
    }
    if (this.store.sources().length >= MAILBOX_SOURCES_MAX) {
      throw new Error(`at most ${MAILBOX_SOURCES_MAX} sources; remove one first`);
    }
    const timer = input.kind === "timer";
    const config = { ...(input.config ?? {}) };
    let state: TimerState | undefined;
    if (timer) {
      const when = timerWhen(config);
      config.when = when;
      state = { nextAt: this.firstRun(when) };
    }
    const source: MailboxSource = {
      id: randomUUID(),
      kind: input.kind,
      name: this.name(input.name),
      note: this.note(input.note ?? "", input.kind),
      config,
      everyMinutes: this.every(input.kind, input.everyMinutes),
      paused: false,
      by: input.by ?? "owner",
      act: timer ? "sort" : this.act(input.act),
      trials: 0,
      createdAt: this.now(),
      // A timer has nothing to look at: it runs at its time.
      started: timer,
      fails: 0,
      letters: 0,
    };
    this.store.addSource(source, state === undefined ? undefined : { state });
    this.ctx.store.audit("mailbox.add", {
      id: source.id,
      kind: source.kind,
      by: source.by,
      act: source.act,
      ...(timer ? { when: describeWhen(config.when as ScheduleWhen) } : {}),
    });
    this.opts.changed?.();
    if (!timer) this.runSoon(source.id);
    return this.store.source(source.id) ?? source;
  }

  set(id: string, patch: MailboxPatch): MailboxSource {
    const old = this.one(id);
    const timer = old.kind === "timer";
    const config = patch.config === undefined ? old.config : { ...patch.config };
    let when: ScheduleWhen | undefined;
    if (timer) {
      when = timerWhen(config);
      config.when = when;
    }
    const next: MailboxSource = {
      ...old,
      ...(patch.name === undefined ? {} : { name: this.name(patch.name) }),
      ...(patch.note === undefined ? {} : { note: this.note(patch.note, old.kind) }),
      config,
      everyMinutes:
        patch.everyMinutes === undefined
          ? old.everyMinutes
          : this.every(old.kind, patch.everyMinutes),
      ...(patch.paused === undefined ? {} : { paused: patch.paused }),
      ...(patch.act === undefined || timer ? {} : { act: this.act(patch.act) }),
    };
    const configChanged = JSON.stringify(config) !== JSON.stringify(old.config);
    const restart = configChanged && !timer;
    if (timer && when !== undefined && !next.paused && (configChanged || old.paused)) {
      // A new time, or back from a pause: the next run is counted from now.
      this.store.keep(id, { ...this.timerState(id), nextAt: this.firstRun(when) });
    }
    this.store.updateSource(next, restart);
    this.ctx.store.audit("mailbox.change", { id, patch: Object.keys(patch) });
    this.opts.changed?.();
    if (restart && !next.paused) this.runSoon(id);
    return this.one(id);
  }

  remove(id: string): boolean {
    const found = this.find(id);
    const removed = found !== undefined && this.store.removeSource(found.id);
    if (removed) {
      this.ctx.store.audit("mailbox.remove", { id: found.id });
      this.opts.changed?.();
    }
    return removed;
  }

  /**
   * One look without keeping anything: what the source would bring now. For the owner to see a
   * source works before adding it, and for a script the Herder wrote. A timer says when it runs.
   */
  async tryOut(input: MailboxSourceInput): Promise<Letter[]> {
    const config = { ...(input.config ?? {}) };
    if (input.kind === "timer") {
      const when = timerWhen(config);
      return [
        {
          id: "next",
          title: this.name(input.name),
          body: `${describeWhen(when)}; next ${this.firstRun(when)}`,
        },
      ];
    }
    const source: MailboxSource = {
      id: "try",
      kind: input.kind,
      name: this.name(input.name),
      note: this.note(input.note ?? "", input.kind),
      config,
      everyMinutes: this.every(input.kind, input.everyMinutes),
      paused: false,
      by: input.by ?? "owner",
      act: this.act(input.act),
      trials: 0,
      createdAt: this.now(),
      started: false,
      fails: 0,
      letters: 0,
    };
    const result = await this.opts.check(source, undefined);
    if (result.skipped === true)
      throw new Error("nothing could be read: is the account signed in?");
    return cleanLetters(result.letters ?? []).slice(0, LETTERS_PER_LOOK);
  }

  /** Looks at a source now (the owner pressed 「现在看一次」); a timer runs now. */
  async runNow(id: string): Promise<number> {
    const source = this.one(id);
    let count = 0;
    await this.serial(async () => {
      if (source.kind === "timer") {
        await this.fire(source, true);
        count = 1;
        return;
      }
      count = await this.look(source);
      this.deliver();
    });
    return count;
  }

  /** Records what the Herder made of letters; returns the ids that are not letters. */
  file(items: readonly { id: number; fate: LetterFate; why: string }[]): number[] {
    const unknown: number[] = [];
    const at = this.now();
    for (const item of items) {
      if (!(LETTER_FATES as readonly string[]).includes(item.fate)) {
        throw new Error(`fate must be one of ${LETTER_FATES.join(", ")}`);
      }
      if (!this.store.file(item.id, item.fate, tidy(item.why, 200), at)) unknown.push(item.id);
    }
    this.opts.changed?.();
    return unknown;
  }

  /** The owner tapped 「开任务」 or 「忽略」 on an offer. */
  async answer(target: string, action: string): Promise<void> {
    const { ctx } = this;
    const { store, texts } = ctx;
    const id = Number(target.slice(MAILBOX_TARGET.length));
    if (!Number.isInteger(id)) return;
    const letter = this.store.letter(id);
    if (letter?.offer === undefined) return;
    const start = action === "start";
    if (!this.store.answer(id, start ? "start" : "ignore")) return;
    const name = this.store.source(letter.sourceId)?.name ?? "";
    store.audit(start ? "mailbox.started" : "mailbox.ignored", { letter: id });
    const ref = letter.offer.ref as MessageRef | null | undefined;
    if (ref !== undefined && ref !== null) {
      try {
        await ctx.opts.channel.update(ref, {
          ...this.offerView(name, letter, letter.offer.trial),
          final: start ? texts.intakeStart : texts.intakeIgnore,
        });
      } catch (error) {
        store.audit("send.error", { kind: "mailbox", message: (error as Error).message });
      }
    }
    this.opts.changed?.();
    if (start && !this.startWork(letterLine(name, letter), false)) {
      await say(ctx, texts.intakeNoHerder);
    }
  }

  /** Every source that is due gets a look, then what came goes to the Herder in one go. */
  tick(): Promise<void> {
    return this.serial(async () => {
      const now = this.ctx.clock.now().getTime();
      for (const source of this.store.sources()) {
        if (source.paused || !this.due(source, now)) continue;
        if (source.kind === "timer") await this.fire(source, false);
        else await this.look(source);
      }
      this.deliver();
      this.digest();
    });
  }

  private serial(run: () => Promise<void>): Promise<void> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  private runSoon(id: string): void {
    if (this.stopped) return;
    void this.serial(async () => {
      const source = this.store.source(id);
      if (source === undefined || source.paused) return;
      await this.look(source);
      this.deliver();
    });
  }

  private timerState(id: string): TimerState {
    return (this.store.memory(id).state as TimerState | undefined) ?? {};
  }

  /** The first run of a new or changed timer; throws when its one time is already past. */
  private firstRun(when: ScheduleWhen): string {
    const next = nextRun(when, this.ctx.clock.now());
    if (next === undefined) throw new Error(`${describeWhen(when)} is already past`);
    return next.toISOString();
  }

  private due(source: MailboxSource, now: number): boolean {
    if (source.kind === "timer") {
      const nextAt = this.timerState(source.id).nextAt;
      return nextAt !== undefined && Date.parse(nextAt) <= now;
    }
    if (source.lastRunAt === undefined) return true;
    let every = source.everyMinutes;
    if (source.kind === "social") {
      // Uneven gaps: the same source and last look always move the same way.
      const span = SOCIAL_JITTER_MINUTES * 2 + 1;
      every += spread(`${source.id}${source.lastRunAt}`, span) - SOCIAL_JITTER_MINUTES;
    }
    return now - Date.parse(source.lastRunAt) >= every * 60_000;
  }

  /**
   * A timer's time came (or the owner said run it now): its words go to the Herder as a turn of
   * their own. Missed runs while AgentHerd was off run once, not once per missed time. A timer
   * that ran its one time is removed.
   */
  private async fire(source: MailboxSource, now_: boolean): Promise<void> {
    const at = this.ctx.clock.now();
    const iso = at.toISOString();
    const state = this.timerState(source.id);
    let when: ScheduleWhen;
    try {
      when = timerWhen(source.config);
    } catch (error) {
      this.store.ranBadly(source.id, iso, (error as Error).message);
      this.opts.changed?.();
      return;
    }
    const next = now_ ? state.nextAt : nextRun(when, at)?.toISOString();
    const herder = this.ctx.herder();
    const ran = herder?.scheduled !== undefined;
    const [letter] = this.store.addLetters(
      source.id,
      [
        {
          id: (now_ ? iso : (state.nextAt ?? iso)).slice(0, 16),
          title: source.name,
          body: source.note,
        },
      ],
      iso,
    );
    if (letter !== undefined) {
      this.store.markSent([letter.id], iso);
      this.store.file(
        letter.id,
        "now",
        this.ctx.texts.mailboxWhy(ran ? "timer" : "no-herder"),
        iso,
      );
    }
    const schedule: Schedule = {
      id: source.id,
      about: source.name,
      prompt: source.note,
      when,
      paused: false,
      createdAt: source.createdAt,
      ...(state.nextAt === undefined ? {} : { nextAt: state.nextAt }),
      lastAt: iso,
    };
    if (!now_ && next === undefined) {
      this.store.removeSource(source.id);
      this.ctx.store.audit("mailbox.done", { id: source.id });
    } else {
      this.store.ranOk(
        source.id,
        iso,
        { ...(next === undefined ? {} : { nextAt: next }), lastAt: iso },
        [],
      );
    }
    this.opts.changed?.();
    if (!ran) {
      this.ctx.store.audit("mailbox.timer-skipped", { id: source.id, reason: "no Herder" });
      return;
    }
    this.ctx.store.audit("mailbox.timer", { id: source.id, due: state.nextAt ?? iso });
    herder.scheduled?.(schedule);
  }

  /** One look at a source; returns how many new letters it kept. */
  private async look(source: MailboxSource): Promise<number> {
    if (this.busy.has(source.id)) return 0;
    this.busy.add(source.id);
    const at = this.now();
    try {
      const memory = this.store.memory(source.id);
      const result = await this.opts.check(source, memory.state);
      if (result?.skipped === true) {
        this.store.touch(source.id, at);
        return 0;
      }
      const found = cleanLetters(Array.isArray(result?.letters) ? result.letters : []);
      const state = result?.state;
      if (state !== undefined && JSON.stringify(state).length > MAILBOX_STATE_MAX) {
        throw new Error(`what the source keeps is over ${MAILBOX_STATE_MAX} characters`);
      }
      const seen = new Set(memory.seen);
      const fresh = found.filter((l) => !seen.has(l.id));
      const ids = [
        ...found.map((l) => l.id),
        ...memory.seen.filter((id) => !found.some((l) => l.id === id)),
      ];
      // The first look only remembers what is there: nothing old is delivered.
      const kept = source.started
        ? this.store.addLetters(source.id, fresh.slice(0, LETTERS_PER_LOOK), at)
        : [];
      this.store.ranOk(source.id, at, state, ids);
      this.ctx.store.audit("mailbox.look", {
        id: source.id,
        found: found.length,
        new: kept.length,
        ...(source.started ? {} : { first: true }),
      });
      await this.actOn(source, kept);
      if (kept.length > 0 || !source.started || source.fails > 0) this.opts.changed?.();
      return kept.length;
    } catch (error) {
      const message = tidy((error as Error).message ?? String(error), 300);
      const fails = this.store.ranBadly(source.id, at, message);
      this.ctx.store.audit("mailbox.error", { id: source.id, message, fails });
      if (fails === MAILBOX_FAILS_TOLD) {
        await say(
          this.ctx,
          this.ctx.texts.mailboxDown(source.name, fails, message),
          undefined,
          "error",
        );
      }
      this.opts.changed?.();
      return 0;
    } finally {
      this.busy.delete(source.id);
    }
  }

  /**
   * New letters of a source that does not leave them to the Herder: each is offered to the owner
   * with 「开任务 / 忽略」, or handed to the Herder to start work (ADR 0100, 0064).
   */
  private async actOn(source: MailboxSource, letters: readonly StoredLetter[]): Promise<void> {
    if (source.act === "sort" || letters.length === 0) return;
    const { ctx } = this;
    const at = this.now();
    this.store.markSent(
      letters.map((l) => l.id),
      at,
    );
    let trials = source.trials;
    for (const letter of letters) {
      const line = letterLine(source.name, letter);
      this.store.file(letter.id, "now", ctx.texts.mailboxWhy(source.act), at);
      ctx.herder()?.event({ kind: "intake", title: source.name, text: line });
      if (source.act === "auto") {
        await say(ctx, ctx.texts.mailboxAuto(source.name, letter.title, letter.link));
        if (!this.startWork(line, true)) await say(ctx, ctx.texts.intakeNoHerder);
        continue;
      }
      // Asked, or on the trial run: the owner gets the offer either way (ADR 0064).
      const trial = source.act === "trial" ? ++trials : undefined;
      const ref = await ctx.outbox.send(this.offerView(source.name, letter, trial));
      this.store.setOffer(letter.id, {
        ...(ref === undefined ? {} : { ref }),
        ...(trial === undefined ? {} : { trial }),
      });
      // The Herder decides as it would and says what it would have started; nothing starts.
      if (trial !== undefined) this.startWork(line, true, true);
    }
    if (trials !== source.trials) {
      const latest = this.store.source(source.id);
      if (latest !== undefined) this.store.updateSource({ ...latest, trials }, false);
    }
  }

  private offerView(name: string, letter: StoredLetter, trial?: number): AskView {
    const { texts } = this.ctx;
    const text = texts.mailboxOffer(name, letter.title, letter.link);
    return {
      kind: "ask",
      askId: `${MAILBOX_TARGET}${letter.id}`,
      text: trial === undefined ? text : `${text}\n${texts.intakeTrial(trial)}`,
      options: [
        { action: "start", label: texts.intakeStart },
        { action: "ignore", label: texts.intakeIgnore },
      ],
    };
  }

  /** Work for a letter through the Herder; false when there is no Herder to take it. */
  private startWork(line: string, auto: boolean, trial?: boolean): boolean {
    const herder = this.ctx.herder();
    if (herder?.intake === undefined) return false;
    herder.intake(line, auto, trial);
    return true;
  }

  /** Letters not yet given to the Herder go to it together. Without a Herder they wait. */
  private deliver(): void {
    const herder = this.ctx.herder();
    if (herder?.letters === undefined) return;
    const letters = this.store.unsent(LETTERS_PER_DELIVERY);
    if (letters.length === 0) return;
    this.store.markSent(
      letters.map((l) => l.id),
      this.now(),
    );
    const groups = groupsOf(letters, (id) => this.store.source(id));
    if (groups.length === 0) return;
    this.ctx.store.audit("mailbox.deliver", { letters: letters.length });
    herder.letters({ kind: "new", groups });
    this.opts.changed?.();
  }

  /** Once a day, at the digest hour, the letters the Herder kept for it go back to it. */
  private digest(): void {
    const herder = this.ctx.herder();
    if (herder?.letters === undefined) return;
    const now = this.ctx.clock.now();
    if (now.getHours() < (this.opts.digestHour ?? DIGEST_HOUR)) return;
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (this.ctx.store.getState<string>(DIGEST_STATE_KEY) === day) return;
    this.ctx.store.setState(DIGEST_STATE_KEY, day);
    const letters = this.store.forDigest(LETTERS_PER_DIGEST);
    if (letters.length === 0) return;
    this.store.markDigested(
      letters.map((l) => l.id),
      this.now(),
    );
    const groups = groupsOf(letters, (id) => this.store.source(id));
    if (groups.length === 0) return;
    this.ctx.store.audit("mailbox.digest", { letters: letters.length });
    herder.letters({ kind: "digest", groups });
  }

  private find(id: string): MailboxSource | undefined {
    return (
      this.store.source(id) ??
      this.store.sources().find((s) => id.length >= 4 && s.id.startsWith(id))
    );
  }

  private one(id: string): MailboxSource {
    const found = this.find(id);
    if (found === undefined) throw new Error(`no source ${id}`);
    return found;
  }

  private name(name: string): string {
    const n = name.replace(/\s+/g, " ").trim();
    if (n === "") throw new Error("a source needs a name");
    return n.slice(0, NAME_MAX);
  }

  private note(note: string, kind: MailboxKind): string {
    const t = tidy(note, kind === "timer" ? TIMER_NOTE_MAX : NOTE_MAX);
    if (kind === "timer" && t === "")
      throw new Error("a timer needs words for the Herder: what to do at the time");
    return t;
  }

  private act(act: MailboxAct | undefined): MailboxAct {
    if (act === undefined) return "sort";
    if (!(MAILBOX_ACTS as readonly string[]).includes(act)) {
      throw new Error(`act must be one of ${MAILBOX_ACTS.join(", ")}`);
    }
    return act;
  }

  private every(kind: MailboxKind, minutes: number | undefined): number {
    if (kind === "timer") return 0;
    if (minutes === undefined) return MAILBOX_EVERY_DEFAULT[kind];
    if (!Number.isFinite(minutes) || minutes < MAILBOX_EVERY_MIN[kind]) {
      throw new Error(
        `a ${kind} source is looked at every ${MAILBOX_EVERY_MIN[kind]} minutes at most`,
      );
    }
    return Math.round(minutes);
  }
}
