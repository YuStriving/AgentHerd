// A task that waits on the owner does not wait forever (ADR 0081). When a task's last report
// said it waits for the owner (a sign-in, a code, an answer) and nothing happened for
// WAIT_ASK_MINUTES, the owner is asked once: 「还要做 / 不做了」. 还要做 sends the task back to
// work, redoing what went stale; 不做了 stops it. With no answer a day later the task is stopped
// and the card says so. Approvals are left alone: they have their own reminder (ADR 0056).
import type { AskView, MessageRef } from "@agentherd/protocol";
import type { Timer } from "./clock.ts";
import type { HerdContext } from "./herd-context.ts";

/** Buttons of a question are this target followed by the task id. */
export const WAIT_TARGET = "wait:";
/** How long a task waits on the owner before they are asked whether it still matters. */
export const WAIT_ASK_MINUTES = 30;
/** How long a question stays unanswered before the task is stopped. */
export const WAIT_GIVE_UP_HOURS = 24;
/** How often waiting tasks are looked at. */
export const WAIT_CHECK_MS = 60_000;
/** herd.db state key: the waiting tasks and the questions asked about them. */
export const WAIT_STATE_KEY = "tasks.waiting";
const LAST_MAX = 200;

/** One task that waits on the owner. */
export interface WaitEntry {
  /** When it started waiting (its last change when first seen waiting). */
  since: string;
  /** When the owner was asked. */
  asked?: string;
  /** The question's message, to close it. */
  ref?: MessageRef;
}

export interface WaitOptions {
  /** 还要做: send the task back to work. */
  keep(taskId: string): Promise<void>;
  /** 不做了, or no answer for a day: stop the task. */
  stop(taskId: string, why: string): Promise<void>;
}

/** How long, in the owner's words: 「40 分钟」「3 小时」「2 天」. */
export function waitedFor(ms: number, unit: { minute: string; hour: string; day: string }): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} ${unit.minute}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${unit.hour}`;
  return `${Math.floor(hours / 24)} ${unit.day}`;
}

export class WaitWatch {
  private readonly ctx: HerdContext;
  private readonly opts: WaitOptions;
  private readonly askMs: number;
  private timer: Timer | undefined;
  private running = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(ctx: HerdContext, opts: WaitOptions, askMinutes = WAIT_ASK_MINUTES) {
    this.ctx = ctx;
    this.opts = opts;
    this.askMs = askMinutes * 60_000;
  }

  start(): void {
    this.running = true;
    void this.check();
  }

  stop(): void {
    this.running = false;
    this.timer?.cancel();
    this.timer = undefined;
  }

  /** Looks at the waiting tasks now. */
  check(): Promise<void> {
    this.chain = this.chain
      .then(() => this.look())
      .catch((error: Error) => {
        this.ctx.store.audit("wait.error", { message: error.message });
      })
      .finally(() => this.schedule());
    return this.chain;
  }

  /** The owner tapped 还要做 or 不做了. */
  async answer(target: string, action: string): Promise<void> {
    const taskId = target.slice(WAIT_TARGET.length);
    const entries = this.entries();
    const entry = entries[taskId];
    const f = this.ctx.following.get(taskId);
    if (entry?.asked === undefined || f === undefined) return;
    const keep = action === "keep";
    const { texts } = this.ctx;
    // Asked again only if it waits again after this answer.
    delete entries[taskId];
    this.save(entries);
    this.ctx.store.audit(keep ? "wait.kept" : "wait.dropped", { taskId });
    await this.close(taskId, entry, keep ? texts.waitKeep : texts.waitDrop);
    if (keep) await this.opts.keep(taskId);
    else await this.opts.stop(taskId, texts.endedByOwner);
  }

  /** A task changed: start looking if one now waits on the owner. */
  nudge(): void {
    this.schedule();
  }

  /** Looks every minute, but only while some task waits or a question is open. */
  private schedule(): void {
    if (!this.running || this.timer !== undefined) return;
    const asked = Object.keys(this.entries()).length > 0;
    if (!asked && ![...this.ctx.following.keys()].some((id) => this.waiting(id))) return;
    this.timer = this.ctx.clock.after(WAIT_CHECK_MS, () => {
      this.timer = undefined;
      void this.check();
    });
  }

  private entries(): Record<string, WaitEntry> {
    return { ...(this.ctx.store.getState<Record<string, WaitEntry>>(WAIT_STATE_KEY) ?? {}) };
  }

  private save(entries: Record<string, WaitEntry>): void {
    this.ctx.store.setState(WAIT_STATE_KEY, entries);
  }

  /** A task's report said it waits on the owner, and no approval card is open for it. */
  private waiting(taskId: string): boolean {
    const f = this.ctx.following.get(taskId);
    if (f === undefined || f.task.stage !== "needs-owner") return false;
    return this.ctx.registry.get(taskId)?.state !== "waiting-approval";
  }

  private async look(): Promise<void> {
    const { ctx } = this;
    const now = ctx.clock.now();
    const entries = this.entries();
    let changed = false;
    // Tasks that went on, or are gone: their question closes.
    for (const [taskId, entry] of Object.entries(entries)) {
      if (this.waiting(taskId)) continue;
      delete entries[taskId];
      changed = true;
      if (entry.asked !== undefined) await this.close(taskId, entry, ctx.texts.waitMovedOn);
    }
    for (const f of ctx.following.values()) {
      const taskId = f.task.id;
      if (!this.waiting(taskId)) continue;
      // First seen waiting: since its last change, so a task that waited before a restart is
      // asked about at once.
      const entry = entries[taskId] ?? { since: f.task.updatedAt };
      if (entries[taskId] === undefined) {
        entries[taskId] = entry;
        changed = true;
      }
      if (entry.asked === undefined) {
        if (now.getTime() - Date.parse(entry.since) < this.askMs) continue;
        const ref = await ctx.outbox.send(this.view(taskId, entry, now), taskId);
        entries[taskId] = {
          ...entry,
          asked: now.toISOString(),
          ...(ref === undefined ? {} : { ref }),
        };
        changed = true;
        ctx.store.audit("wait.asked", { taskId, since: entry.since });
        continue;
      }
      if (now.getTime() - Date.parse(entry.asked) < WAIT_GIVE_UP_HOURS * 3_600_000) continue;
      delete entries[taskId];
      changed = true;
      ctx.store.audit("wait.gave-up", { taskId });
      await this.close(taskId, entry, ctx.texts.waitGaveUp);
      await this.opts.stop(taskId, ctx.texts.waitGaveUpWhy);
    }
    if (changed) this.save(entries);
  }

  private view(taskId: string, entry: WaitEntry, now: Date): AskView {
    const { texts, following } = this.ctx;
    const task = following.get(taskId)?.task;
    const title = task?.title ?? taskId;
    const ago = Date.parse(entry.since);
    const waited = waitedFor(Number.isNaN(ago) ? this.askMs : now.getTime() - ago, texts.waitUnits);
    return {
      kind: "ask",
      askId: `${WAIT_TARGET}${taskId}`,
      text: texts.waitAsk(title, waited, lastWords(task?.lastReport ?? "", texts.reported(""))),
      options: [
        { action: "keep", label: texts.waitKeep },
        { action: "drop", label: texts.waitDrop },
      ],
    };
  }

  private async close(taskId: string, entry: WaitEntry, final: string): Promise<void> {
    if (entry.ref === undefined) return;
    // Drawn as it was asked, with only the buttons replaced by what happened.
    const asked = entry.asked === undefined ? this.ctx.clock.now() : new Date(entry.asked);
    const view = this.view(taskId, entry, asked);
    try {
      await this.ctx.opts.channel.update(entry.ref, { ...view, final });
    } catch (error) {
      this.ctx.store.audit("send.error", { kind: "wait", message: (error as Error).message });
    }
  }
}

/** The task's last report without the board's 「已报告：」, on one short line. */
function lastWords(report: string, prefix: string): string {
  const text = (report.startsWith(prefix) ? report.slice(prefix.length) : report)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > LAST_MAX ? `${text.slice(0, LAST_MAX)}…` : text;
}
