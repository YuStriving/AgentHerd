import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  MEMORY_TABLES_SQL,
  MemoryFullError,
  MemoryStore,
  PROFILE_FIELDS,
  profileField,
  RESIDENT_CAPS,
  RESIDENT_KINDS,
  Store,
} from "../src/index.ts";

const herder = { actor: "herder", source: "said" } as const;

/** A memory store on its own database with a clock the test moves. */
function clocked(start: string): { m: MemoryStore; set: (iso: string) => void; at: () => Date } {
  let now = new Date(start);
  const db = new DatabaseSync(":memory:");
  db.exec(MEMORY_TABLES_SQL);
  return {
    m: new MemoryStore(db, undefined, () => now),
    set: (iso) => {
      now = new Date(iso);
    },
    at: () => now,
  };
}

describe("MemoryStore", () => {
  it("adds, replaces by superseding, removes, and keeps every change", () => {
    const store = Store.open(":memory:");
    const m = store.memory;
    const { ids } = m.write(
      [{ op: "add", kind: "owner", abstract: "报告用中文", evidence: "以后报告都用中文" }],
      herder,
    );
    const first = ids[0] as string;
    const { ids: next } = m.write(
      [{ op: "replace", id: first, abstract: "报告用中文，三行以内" }],
      herder,
    );
    const second = next[0] as string;
    expect(m.get(first)?.status).toBe("superseded");
    expect(m.get(first)?.supersededBy).toBe(second);
    expect(m.get(second)).toMatchObject({ rev: 2, evidence: "以后报告都用中文", status: "active" });
    expect(m.list({ kinds: ["owner"] }).map((r) => r.abstract)).toEqual(["报告用中文，三行以内"]);

    m.write([{ op: "remove", id: second }], herder);
    expect(m.list({ kinds: ["owner"] })).toEqual([]);
    expect(m.revisions({ memoryId: second }).map((r) => r.op)).toEqual(["remove", "add"]);
    store.close();
  });

  it("undoes a whole batch", () => {
    const store = Store.open(":memory:");
    const m = store.memory;
    const { ids } = m.write(
      [{ op: "add", kind: "note", abstract: "飞书机器人只在工作日开" }],
      herder,
    );
    const id = ids[0] as string;
    const { batchId } = m.write(
      [
        { op: "replace", id, abstract: "飞书机器人每天都开" },
        { op: "add", kind: "person", abstract: "小王负责前端" },
      ],
      herder,
    );
    m.undo(batchId);
    expect(m.list().map((r) => r.abstract)).toEqual(["飞书机器人只在工作日开"]);
    expect(m.get(id)?.status).toBe("active");
    store.close();
  });

  it("rejects a write that passes a resident cap and returns what is there", () => {
    const store = Store.open(":memory:");
    const m = store.memory;
    const long = "很".repeat(190);
    const ops = Array.from({ length: Math.ceil(RESIDENT_CAPS.owner / 190) - 1 }, () => ({
      op: "add" as const,
      kind: "owner" as const,
      abstract: long,
    }));
    m.write(ops, herder);
    let error: unknown;
    try {
      m.write(
        [
          { op: "add", kind: "owner", abstract: long },
          { op: "add", kind: "owner", abstract: long },
        ],
        herder,
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MemoryFullError);
    expect((error as MemoryFullError).entries).toHaveLength(ops.length);
    expect(m.list({ kinds: ["owner"] })).toHaveLength(ops.length);
    // Other kinds are not capped.
    m.write([{ op: "add", kind: "case", abstract: long }], { actor: "task", source: "task" });
    store.close();
  });

  it("finds Chinese and short words, skips inactive and expired entries", () => {
    const { m, set } = clocked("2026-11-06T08:00:00Z");
    m.write(
      [
        {
          op: "add",
          kind: "case",
          abstract: "修复 pi-desktop 的打包错误",
          body: "electron-builder 签名失败",
        },
        { op: "add", kind: "note", abstract: "deepseek 余额不足时换 kimi", until: "2026-11-07" },
        { op: "add", kind: "person", abstract: "小王负责前端" },
      ],
      herder,
    );
    expect(m.search("打包错误").map((h) => h.abstract)).toEqual(["修复 pi-desktop 的打包错误"]);
    expect(m.search("签名").map((h) => h.abstract)).toEqual(["修复 pi-desktop 的打包错误"]);
    expect(m.search("前端").map((h) => h.abstract)).toEqual(["小王负责前端"]);
    expect(m.search("余额", { kinds: ["case"] })).toEqual([]);
    set("2026-11-08T08:00:00Z");
    expect(m.search("余额")).toEqual([]);
    expect(m.list({ status: "expired" }).map((r) => r.kind)).toEqual(["note"]);
  });

  it("redacts secrets and clips long text", () => {
    const store = Store.open(":memory:", { secrets: { key: "sk-secret-123456" } });
    const { ids } = store.memory.write(
      [{ op: "add", kind: "note", abstract: `key sk-secret-123456 ${"x".repeat(300)}` }],
      herder,
    );
    const row = store.memory.get(ids[0] as string);
    expect(row?.abstract).not.toContain("sk-secret-123456");
    expect(row?.abstract.length).toBeLessThanOrEqual(200);
    store.close();
  });

  it("keeps vectors and finds entries without one", () => {
    const store = Store.open(":memory:");
    const m = store.memory;
    const { ids } = m.write(
      [
        { op: "add", kind: "case", abstract: "abbb" },
        { op: "add", kind: "case", abstract: "cddd" },
      ],
      herder,
    );
    m.setVector(ids[0] as string, "bge", new Float32Array([0.5, -1, 2]));
    expect(m.vectors("bge")).toEqual([{ id: ids[0], vec: new Float32Array([0.5, -1, 2]) }]);
    expect(m.missingVectors("bge").map((r) => r.id)).toEqual([ids[1]]);
    store.close();
  });

  it("runs jobs once, retries failures later, then gives up", () => {
    const { m, set, at } = clocked("2026-11-06T08:00:00Z");
    const later = (ms: number) => set(new Date(at().getTime() + ms).toISOString());
    const id = m.enqueueJob("case", { taskId: "t1" });
    const job = m.claimJob();
    expect(job).toMatchObject({ id, kind: "case", payload: { taskId: "t1" }, attempts: 0 });
    expect(m.claimJob()).toBeUndefined();
    m.failJob(id, "timeout");
    expect(m.claimJob()).toBeUndefined();
    later(61_000);
    expect(m.claimJob()?.id).toBe(id);
    m.failJob(id, "timeout");
    later(601_000);
    m.claimJob();
    m.failJob(id, "timeout");
    later(3_601_000);
    m.claimJob();
    m.failJob(id, "timeout");
    expect(m.jobs()[0]).toMatchObject({ state: "failed", attempts: 4 });
    m.retryJob(id);
    expect(m.claimJob()?.id).toBe(id);
    m.finishJob(id);
    expect(m.jobs()[0]?.state).toBe("done");
  });

  it("adds the memory tables to a version-4 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");
    Store.open(dbPath).close();
    const raw = new DatabaseSync(dbPath);
    for (const t of [
      "memories_fts",
      "memories",
      "memory_vectors",
      "memory_revisions",
      "memory_log",
      "memory_jobs",
    ]) {
      raw.exec(`DROP TABLE ${t}`);
    }
    raw.exec("UPDATE schema_version SET version = 4");
    raw.close();
    const migrated = Store.open(dbPath);
    migrated.memory.write([{ op: "add", kind: "owner", abstract: "用中文" }], herder);
    expect(migrated.memory.list()).toHaveLength(1);
    migrated.close();
  });
});

describe("the owner's profile card (ADR 0091)", () => {
  const owner = { actor: "owner", source: "owner_edit" } as const;

  it("finds the field an entry is about", () => {
    expect(profileField("称呼：火哥")).toBe("称呼");
    expect(profileField("回答方式: 先说结论")).toBe("回答方式");
    expect(profileField("在做")).toBeUndefined();
    expect(profileField("爱好：爬山")).toBeUndefined();
    expect(PROFILE_FIELDS).toContain("在意");
  });

  it("keeps one entry per field: a new one takes the old one's place", () => {
    const m = Store.open(":memory:").memory;
    m.write([{ op: "add", kind: "profile", abstract: "称呼：小火" }], owner);
    m.write([{ op: "add", kind: "profile", abstract: "在做：AgentHerd" }], owner);
    const { ids } = m.write([{ op: "add", kind: "profile", abstract: "称呼：火哥" }], owner);
    const rows = m.list({ kinds: ["profile"] });
    expect(rows.map((r) => r.abstract).sort()).toEqual(["在做：AgentHerd", "称呼：火哥"]);
    const now = m.get(ids[0] as string);
    expect(now?.rev).toBe(2);
    expect(m.list({ status: "all" }).find((r) => r.abstract === "称呼：小火")?.status).toBe(
      "superseded",
    );
  });

  it("is resident and has its own cap", () => {
    const m = Store.open(":memory:").memory;
    expect(RESIDENT_KINDS).toContain("profile");
    m.write([{ op: "add", kind: "profile", abstract: `在意：${"很".repeat(150)}` }], owner);
    expect(m.used("profile")).toBe(153);
    for (const field of ["身份", "在做"]) {
      m.write([{ op: "add", kind: "profile", abstract: `${field}：${"字".repeat(150)}` }], owner);
    }
    expect(() =>
      m.write([{ op: "add", kind: "profile", abstract: `喜好：${"多".repeat(150)}` }], owner),
    ).toThrow(MemoryFullError);
    expect(RESIDENT_CAPS.profile).toBe(600);
  });
});
