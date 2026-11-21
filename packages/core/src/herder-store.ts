// The Herder's conversation and context in herd.db (ADR 0095): messages with what they are,
// rounds, requests with usage, folds, events and prompts. The Store hands these out; nothing here
// opens a transaction of its own.

import type { DatabaseSync } from "node:sqlite";
import { herderMessageFacts } from "./herder-log.ts";
import type {
  HerderContextParts,
  HerderEventRecord,
  HerderFoldRecord,
  HerderPromptRecord,
  HerderRequestRecord,
} from "./herder-port.ts";

/** Requests read at most at once for the 上下文 tab. */
export const HERDER_REQUESTS_READ_MAX = 5000;
/** System prompts kept; older ones are deleted (each is the whole prompt and tool list). */
export const HERDER_PROMPTS_KEEP = 200;

/** A stored message with what is kept next to it. */
export interface HerderMessageRow {
  seq: number;
  at: string;
  role: string;
  kind: string;
  tool?: string;
  round: number;
  tokens: number;
  chars: number;
}

/** Token use of a day (`day` is "" for the total). */
export interface HerderUsageRow {
  day: string;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/** A round: the message that started it and what came of it. */
export interface HerderRoundRow {
  seq: number;
  at: string;
  kind: string;
  title: string;
}

function optNumber(v: unknown): number | undefined {
  return v === null || v === undefined ? undefined : Number(v);
}

function optString(v: unknown): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}

export class HerderStore {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  /** The whole conversation as the model saw it, oldest first. */
  log(): unknown[] {
    return this.db
      .prepare("SELECT message_json FROM herder_messages ORDER BY seq")
      .all()
      .map((row) => JSON.parse(row.message_json as string) as unknown);
  }

  /**
   * Replaces the conversation from `from` on (a rolled-back try is rewritten), and the rounds that
   * start there. A user message starts a round; the rest belong to the round before them.
   */
  writeLog(from: number, messages: unknown[]): void {
    this.db.prepare("DELETE FROM herder_messages WHERE seq >= ?").run(from);
    this.db.prepare("DELETE FROM herder_rounds WHERE seq >= ?").run(from);
    const prev = this.db
      .prepare("SELECT round, at FROM herder_messages WHERE seq < ? ORDER BY seq DESC LIMIT 1")
      .get(from);
    let round = prev === undefined ? from : Number(prev.round);
    let lastAt = prev === undefined ? "" : String(prev.at);
    const insert = this.db.prepare(
      "INSERT INTO herder_messages(seq, at, role, kind, tool, round, tokens, chars, message_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertRound = this.db.prepare(
      "INSERT OR REPLACE INTO herder_rounds(seq, at, kind, title) VALUES (?, ?, ?, ?)",
    );
    for (const [i, message] of messages.entries()) {
      const seq = from + i;
      const facts = herderMessageFacts(message);
      // Messages without a time take the one before; times never go back.
      const at =
        facts.at !== undefined && facts.at >= lastAt
          ? facts.at
          : lastAt !== ""
            ? lastAt
            : this.now().toISOString();
      lastAt = at;
      if (facts.role === "user") {
        round = seq;
        insertRound.run(seq, at, facts.kind, facts.title ?? "");
      }
      insert.run(
        seq,
        at,
        facts.role,
        facts.kind,
        facts.tool ?? null,
        round,
        facts.tokens,
        facts.chars,
        JSON.stringify(message),
      );
    }
  }

  /** What is kept next to each message from `from` on, at most `limit`, oldest first. */
  messages(from = 0, limit = 100_000): HerderMessageRow[] {
    return this.db
      .prepare(
        "SELECT seq, at, role, kind, tool, round, tokens, chars FROM herder_messages WHERE seq >= ? ORDER BY seq LIMIT ?",
      )
      .all(from, limit)
      .map((r) => ({
        seq: Number(r.seq),
        at: String(r.at),
        role: String(r.role),
        kind: String(r.kind),
        ...(r.tool === null ? {} : { tool: String(r.tool) }),
        round: Number(r.round),
        tokens: Number(r.tokens),
        chars: Number(r.chars),
      }));
  }

  /** One stored message, as saved; undefined when there is none at `seq`. */
  message(seq: number): unknown {
    const row = this.db.prepare("SELECT message_json FROM herder_messages WHERE seq = ?").get(seq);
    return row === undefined ? undefined : (JSON.parse(String(row.message_json)) as unknown);
  }

  rounds(): HerderRoundRow[] {
    return this.db
      .prepare("SELECT seq, at, kind, title FROM herder_rounds ORDER BY seq")
      .all()
      .map((r) => ({
        seq: Number(r.seq),
        at: String(r.at),
        kind: String(r.kind),
        title: String(r.title),
      }));
  }

  addRequest(r: HerderRequestRecord): void {
    this.db
      .prepare(
        "INSERT INTO herder_requests(at, seq, round, model, input, output, cache_read, cache_write, cost, tokens, window, parts_json, prompt, failed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        r.at,
        r.seq ?? null,
        r.round ?? null,
        r.model,
        r.input,
        r.output,
        r.cacheRead,
        r.cacheWrite,
        r.cost ?? 0,
        r.tokens,
        r.window ?? null,
        r.parts === undefined ? null : JSON.stringify(r.parts),
        r.prompt ?? null,
        r.failed === true ? 1 : 0,
      );
  }

  /** Token use per local day, oldest first; `total` sums them all. */
  requestDays(): { days: HerderUsageRow[]; total: HerderUsageRow } {
    const sums =
      "COUNT(*) AS n, COALESCE(SUM(input), 0) AS i, COALESCE(SUM(output), 0) AS o, COALESCE(SUM(cache_read), 0) AS r, COALESCE(SUM(cache_write), 0) AS w, COALESCE(SUM(cost), 0) AS c";
    const row = (r: Record<string, unknown>, day: string): HerderUsageRow => ({
      day,
      requests: Number(r.n),
      input: Number(r.i),
      output: Number(r.o),
      cacheRead: Number(r.r),
      cacheWrite: Number(r.w),
      cost: Number(r.c),
    });
    const days = this.db
      .prepare(
        `SELECT date(at, 'localtime') AS day, ${sums} FROM herder_requests GROUP BY day ORDER BY day`,
      )
      .all()
      .map((r) => row(r, String(r.day)));
    const total = this.db.prepare(`SELECT ${sums} FROM herder_requests`).get() ?? {};
    return { days, total: row(total, "") };
  }

  /** Changes whenever a message, fold, request, event or prompt is written. */
  version(): string {
    const one = (sql: string) => Object.values(this.db.prepare(sql).get() ?? {}).join(",");
    return [
      one("SELECT COUNT(*), MAX(seq), MAX(at), SUM(chars) FROM herder_messages"),
      one("SELECT COUNT(*), MAX(updated_at) FROM herder_folds"),
      one("SELECT MAX(id) FROM herder_requests"),
      one("SELECT MAX(id) FROM herder_events"),
      one("SELECT hash FROM herder_prompts ORDER BY at DESC, rowid DESC LIMIT 1"),
    ].join("|");
  }

  /** Requests since `since` (an ISO time), oldest first, at most `limit` of the newest. */
  requests(since: string, limit = HERDER_REQUESTS_READ_MAX): HerderRequestRecord[] {
    const rows = this.db
      .prepare(
        "SELECT at, seq, round, model, input, output, cache_read, cache_write, cost, tokens, window, parts_json, prompt, failed FROM herder_requests WHERE at >= ? ORDER BY id DESC LIMIT ?",
      )
      .all(since, limit);
    return rows.reverse().map((r) => {
      const seq = optNumber(r.seq);
      const round = optNumber(r.round);
      const prompt = optString(r.prompt);
      const window = optNumber(r.window);
      return {
        at: String(r.at),
        model: String(r.model),
        input: Number(r.input),
        output: Number(r.output),
        cacheRead: Number(r.cache_read),
        cacheWrite: Number(r.cache_write),
        cost: Number(r.cost),
        tokens: Number(r.tokens),
        ...(window === undefined ? {} : { window }),
        ...(r.parts_json === null
          ? {}
          : { parts: JSON.parse(String(r.parts_json)) as HerderContextParts }),
        ...(seq === undefined ? {} : { seq }),
        ...(round === undefined ? {} : { round }),
        ...(prompt === undefined ? {} : { prompt }),
        ...(Number(r.failed) === 1 ? { failed: true } : {}),
      };
    });
  }

  /** Every fold ever kept, in the order they were made. */
  folds(): HerderFoldRecord[] {
    return this.db
      .prepare(
        "SELECT block_id, parent, level, state, made_by, topic, summary, start_seq, end_seq, direct_start, direct_end, messages, call_seq, tokens_before, tokens_after, created_at, updated_at, block_json FROM herder_folds ORDER BY num, block_id",
      )
      .all()
      .map((r) => {
        const parent = optString(r.parent);
        const topic = optString(r.topic);
        const directStart = optNumber(r.direct_start);
        const directEnd = optNumber(r.direct_end);
        const callSeq = optNumber(r.call_seq);
        return {
          blockId: String(r.block_id),
          ...(parent === undefined ? {} : { parent }),
          level: Number(r.level),
          state: String(r.state) as HerderFoldRecord["state"],
          by: String(r.made_by) as HerderFoldRecord["by"],
          ...(topic === undefined ? {} : { topic }),
          summary: String(r.summary),
          startSeq: Number(r.start_seq),
          endSeq: Number(r.end_seq),
          ...(directStart === undefined ? {} : { directStart }),
          ...(directEnd === undefined ? {} : { directEnd }),
          messages: Number(r.messages),
          ...(callSeq === undefined ? {} : { callSeq }),
          tokensBefore: Number(r.tokens_before),
          tokensAfter: Number(r.tokens_after),
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
          block: JSON.parse(String(r.block_json)) as unknown,
        };
      });
  }

  /** Writes folds that are new or changed; a fold is never deleted. */
  putFolds(folds: readonly HerderFoldRecord[]): void {
    const put = this.db.prepare(
      "INSERT OR REPLACE INTO herder_folds(block_id, num, parent, level, state, made_by, topic, summary, start_seq, end_seq, direct_start, direct_end, messages, call_seq, tokens_before, tokens_after, created_at, updated_at, block_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const f of folds) {
      put.run(
        f.blockId,
        Number(/\d+/.exec(f.blockId)?.[0] ?? 0),
        f.parent ?? null,
        f.level,
        f.state,
        f.by,
        f.topic ?? null,
        f.summary,
        f.startSeq,
        f.endSeq,
        f.directStart ?? null,
        f.directEnd ?? null,
        f.messages,
        f.callSeq ?? null,
        f.tokensBefore,
        f.tokensAfter,
        f.createdAt,
        f.updatedAt,
        JSON.stringify(f.block),
      );
    }
  }

  addEvent(kind: string, data: Record<string, unknown>, round?: number): void {
    this.db
      .prepare("INSERT INTO herder_events(at, kind, round, data_json) VALUES (?, ?, ?, ?)")
      .run(this.now().toISOString(), kind, round ?? null, JSON.stringify(data));
  }

  /** Events since `since`, oldest first, at most `limit` of the newest. */
  events(since: string, limit = 1000): HerderEventRecord[] {
    return this.db
      .prepare(
        "SELECT id, at, kind, round, data_json FROM herder_events WHERE at >= ? ORDER BY id DESC LIMIT ?",
      )
      .all(since, limit)
      .reverse()
      .map((r) => {
        const round = optNumber(r.round);
        return {
          id: Number(r.id),
          at: String(r.at),
          kind: String(r.kind),
          ...(round === undefined ? {} : { round }),
          data: JSON.parse(String(r.data_json)) as Record<string, unknown>,
        };
      });
  }

  /** Keeps a system prompt once; the oldest go when there are too many. */
  putPrompt(p: HerderPromptRecord): void {
    const info = this.db
      .prepare(
        "INSERT OR IGNORE INTO herder_prompts(hash, at, tokens, system, tools_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(p.hash, this.now().toISOString(), p.tokens, p.system, JSON.stringify(p.tools));
    if (Number(info.changes) === 0) return;
    this.db
      .prepare(
        "DELETE FROM herder_prompts WHERE hash IN (SELECT hash FROM herder_prompts ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET ?)",
      )
      .run(HERDER_PROMPTS_KEEP);
  }

  /** A kept prompt by hash, or the newest when no hash is given. */
  prompt(hash?: string): (HerderPromptRecord & { at: string }) | undefined {
    const row =
      hash === undefined
        ? this.db
            .prepare(
              "SELECT hash, at, tokens, system, tools_json FROM herder_prompts ORDER BY at DESC, rowid DESC LIMIT 1",
            )
            .get()
        : this.db
            .prepare(
              "SELECT hash, at, tokens, system, tools_json FROM herder_prompts WHERE hash = ?",
            )
            .get(hash);
    return row === undefined
      ? undefined
      : {
          hash: String(row.hash),
          at: String(row.at),
          tokens: Number(row.tokens),
          system: String(row.system),
          tools: JSON.parse(String(row.tools_json)) as unknown[],
        };
  }

  /**
   * Schema 17 (ADR 0095): moves `herder_log` into `herder_messages` and fills `herder_requests`
   * from the usage every saved reply carries. The few rows of the schema-16 request table go:
   * the replies hold the same numbers.
   */
  migrate(tables: string): void {
    this.db.exec("DROP TABLE IF EXISTS herder_requests");
    this.db.exec(tables);
    const hasLog =
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'herder_log'")
        .get() !== undefined;
    if (!hasLog) return;
    const messages = this.db
      .prepare("SELECT message_json FROM herder_log ORDER BY seq")
      .all()
      .map((row) => JSON.parse(String(row.message_json)) as unknown);
    this.writeLog(0, messages);
    this.db.exec("DROP TABLE herder_log");
    this.backfillRequests();
  }

  /** One request row for every saved reply that says what the provider counted. */
  private backfillRequests(): void {
    const rows = this.db
      .prepare(
        "SELECT seq, at, round, message_json FROM herder_messages WHERE role = 'assistant' ORDER BY seq",
      )
      .all();
    for (const row of rows) {
      const m = JSON.parse(String(row.message_json)) as {
        provider?: string;
        model?: string;
        stopReason?: string;
        usage?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
          cost?: { total?: number };
        };
      };
      const u = m.usage;
      if (u === undefined) continue;
      const input = u.input ?? 0;
      const cacheRead = u.cacheRead ?? 0;
      const cacheWrite = u.cacheWrite ?? 0;
      this.addRequest({
        at: String(row.at),
        seq: Number(row.seq),
        round: Number(row.round),
        model: `${m.provider ?? "?"}/${m.model ?? "?"}`,
        input,
        output: u.output ?? 0,
        cacheRead,
        cacheWrite,
        cost: u.cost?.total ?? 0,
        tokens: input + cacheRead + cacheWrite,
        ...(m.stopReason === "error" ? { failed: true } : {}),
      });
    }
  }
}
