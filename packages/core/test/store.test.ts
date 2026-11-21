import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Decision, Item, ReportView, Rule } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import type { SessionRow } from "../src/index.ts";
import { HERDER_PROMPTS_KEEP, OWNER_CARDS_KEEP, Store } from "../src/index.ts";
import { HERDER_LOG_TABLE_SQL, HERDER_REQUESTS_V16_SQL } from "../src/store-schema.ts";

const NOW = "2026-11-04T00:00:00.000Z";
const REDACTED = "«redacted»";

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    sessionId: "session-1",
    profileId: "profile-1",
    cwd: "/work/proj",
    kind: "permission",
    state: "open",
    createdAt: NOW,
    title: "Run tests",
    body: "pnpm test",
    risk: "low",
    ...over,
  };
}

describe("Store (in-memory)", () => {
  it("round-trips sessions", () => {
    const store = Store.open(":memory:");
    const session: SessionRow = {
      id: "session-1",
      profileId: "profile-1",
      cwd: "/work/proj",
      state: "working",
      createdAt: NOW,
      updatedAt: NOW,
    };
    store.upsertSession(session);
    expect(store.getSession("session-1")).toEqual(session);
    expect(store.getSession("missing")).toBeUndefined();
  });

  it("replaces a session on upsert by id", () => {
    const store = Store.open(":memory:");
    store.upsertSession({
      id: "session-1",
      profileId: "profile-1",
      cwd: "/work/proj",
      state: "working",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const updated: SessionRow = {
      id: "session-1",
      profileId: "profile-2",
      cwd: "/other",
      state: "idle",
      createdAt: NOW,
      updatedAt: "2026-11-04T00:00:01.000Z",
    };
    store.upsertSession(updated);
    expect(store.getSession("session-1")).toEqual(updated);
  });

  it("round-trips items including toolCall", () => {
    const store = Store.open(":memory:");
    const item = makeItem({
      toolCall: { kind: "execute", title: "run", command: "pnpm test", paths: ["src"] },
    });
    store.insertItem(item);
    expect(store.getItem(item.id)).toEqual({
      id: item.id,
      sessionId: item.sessionId,
      profileId: item.profileId,
      cwd: item.cwd,
      kind: item.kind,
      state: item.state,
      createdAt: item.createdAt,
      title: item.title,
      body: item.body,
      risk: item.risk,
      toolCall: item.toolCall,
    });
  });

  it("does not store the item decision field", () => {
    const store = Store.open(":memory:");
    const decision: Decision = {
      itemId: "item-1",
      action: "allow",
      confidence: 1,
      risk: "low",
      source: "rule",
      reason: "matched",
      precedents: [],
    };
    store.insertItem(makeItem({ decision }));
    const got = store.getItem("item-1");
    expect(got).toBeDefined();
    expect("decision" in (got ?? {})).toBe(false);
  });

  it("applies a partial updateItem patch", () => {
    const store = Store.open(":memory:");
    store.insertItem(makeItem({ id: "item-1" }));

    store.updateItem("item-1", { state: "decided", decidedAt: "2026-11-04T01:00:00.000Z" });
    const first = store.getItem("item-1");
    expect(first?.state).toBe("decided");
    expect(first?.decidedAt).toBe("2026-11-04T01:00:00.000Z");
    expect(first?.risk).toBe("low");
    expect(first?.body).toBe("pnpm test");

    store.updateItem("item-1", {
      risk: "high",
      messageRef: { channelId: "ch-1", id: "msg-1" },
    });
    const second = store.getItem("item-1");
    expect(second?.risk).toBe("high");
    expect(second?.messageRef).toEqual({ channelId: "ch-1", id: "msg-1" });
    expect(second?.state).toBe("decided");
    expect(second?.decidedAt).toBe("2026-11-04T01:00:00.000Z");
  });

  it("filters openItems to state = 'open' in created_at order", () => {
    const store = Store.open(":memory:");
    store.insertItem(makeItem({ id: "open-1", createdAt: "2026-11-04T00:00:00.000Z" }));
    store.insertItem(makeItem({ id: "open-2", createdAt: "2026-11-04T00:00:02.000Z" }));
    store.insertItem(makeItem({ id: "decided-1", state: "decided" }));
    expect(store.openItems().map((i) => i.id)).toEqual(["open-1", "open-2"]);
  });

  it("round-trips decisions with optional fields", () => {
    const store = Store.open(":memory:");
    const withOptional: Decision = {
      itemId: "item-1",
      action: "allow",
      text: "go ahead",
      confidence: 0.9,
      risk: "low",
      source: "rule",
      reason: "matches allow rule",
      precedents: ["rule-1"],
    };
    store.insertDecision(withOptional, { ruleId: "rule-1", ownerId: "owner-1", createdAt: NOW });

    const withoutOptional: Decision = {
      itemId: "item-1",
      action: "deny",
      confidence: 0.5,
      risk: "high",
      source: "human",
      reason: "blocked by owner",
      precedents: [],
    };
    store.insertDecision(withoutOptional, { createdAt: "2026-11-04T00:00:01.000Z" });

    expect(store.decisionsFor("item-1")).toEqual([
      { ...withOptional, ruleId: "rule-1", ownerId: "owner-1", createdAt: NOW },
      { ...withoutOptional, createdAt: "2026-11-04T00:00:01.000Z" },
    ]);
  });

  it("round-trips rules and reports deleteRule", () => {
    const store = Store.open(":memory:");
    const rule: Rule = {
      id: "rule-1",
      action: "allow",
      match: { toolKind: "execute", command: "pnpm test*" },
      createdAt: NOW,
      createdBy: "owner",
    };
    store.insertRule(rule);
    expect(store.listRules()).toEqual([rule]);
    expect(store.deleteRule("rule-1")).toBe(true);
    expect(store.deleteRule("rule-1")).toBe(false);
    expect(store.listRules()).toEqual([]);
  });

  it("round-trips audit rows and filters by kind", () => {
    const store = Store.open(":memory:");
    store.audit("decision", { itemId: "item-1", action: "allow" }, "2026-11-04T01:00:00.000Z");
    store.audit("session", { sessionId: "session-1" }, "2026-11-04T02:00:00.000Z");
    expect(store.auditRows()).toEqual([
      {
        id: 1,
        at: "2026-11-04T01:00:00.000Z",
        kind: "decision",
        data: { itemId: "item-1", action: "allow" },
      },
      {
        id: 2,
        at: "2026-11-04T02:00:00.000Z",
        kind: "session",
        data: { sessionId: "session-1" },
      },
    ]);
    expect(store.auditRows("session")).toEqual([
      { id: 2, at: "2026-11-04T02:00:00.000Z", kind: "session", data: { sessionId: "session-1" } },
    ]);
  });

  it("redacts an env secret in item body, toolCall command, decision reason and audit data", () => {
    const secret = "sk-abcdefghijklmnop1234";
    const store = Store.open(":memory:", { secrets: { API_KEY: secret } });
    const item = makeItem({
      id: "item-secret",
      body: `body has ${secret}`,
      toolCall: { kind: "execute", title: "run", command: `run ${secret}`, paths: [] },
    });
    store.insertItem(item);
    store.insertDecision(
      {
        itemId: "item-secret",
        action: "deny",
        confidence: 1,
        risk: "high",
        source: "human",
        reason: `denied because ${secret}`,
        precedents: [],
      },
      { createdAt: NOW },
    );
    store.audit("decision", { reason: `used ${secret}` }, NOW);

    const got = store.getItem("item-secret");
    expect(got?.body).toBe(`body has ${REDACTED}`);
    expect(got?.body).not.toContain(secret);
    expect(got?.toolCall?.command).toBe(`run ${REDACTED}`);
    expect(got?.toolCall?.command).not.toContain(secret);

    const decisions = store.decisionsFor("item-secret");
    expect(decisions[0]?.reason).toBe(`denied because ${REDACTED}`);
    expect(decisions[0]?.reason).not.toContain(secret);

    const rows = store.auditRows("decision");
    expect(rows[0]?.data).toEqual({ reason: `used ${REDACTED}` });
  });
});

describe("Store (file-backed)", () => {
  it("creates the parent directory with mode 0o700 and keeps data on reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "nested", "herd.db");

    const first = Store.open(dbPath);
    const session: SessionRow = {
      id: "session-1",
      profileId: "profile-1",
      cwd: "/work/proj",
      state: "working",
      createdAt: NOW,
      updatedAt: NOW,
    };
    first.upsertSession(session);
    first.close();

    if (process.platform !== "win32") {
      expect(statSync(join(dir, "nested")).mode & 0o777).toBe(0o700);
    }

    const reopened = Store.open(dbPath);
    expect(reopened.getSession("session-1")).toEqual(session);
    reopened.close();
  });

  it("throws on an unsupported schema version", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");

    const first = Store.open(dbPath);
    first.close();

    const raw = new DatabaseSync(dbPath);
    raw.exec("UPDATE schema_version SET version = 99");
    raw.close();

    expect(() => Store.open(dbPath)).toThrow("unsupported herd.db schema version 99");
  });
});

describe("Store (state)", () => {
  it("round-trips a value and returns undefined for a missing key", () => {
    const store = Store.open(":memory:");
    store.setState("mode", "relay");
    expect(store.getState<string>("mode")).toBe("relay");
    expect(store.getState("missing")).toBeUndefined();
  });

  it("overwrites an existing key", () => {
    const store = Store.open(":memory:");
    store.setState("count", 1);
    store.setState("count", 2);
    expect(store.getState<number>("count")).toBe(2);
  });

  it("deletes a key", () => {
    const store = Store.open(":memory:");
    store.setState("token", "abc");
    expect(store.getState("token")).toBe("abc");
    store.deleteState("token");
    expect(store.getState("token")).toBeUndefined();
  });

  it("round-trips a structured value through JSON", () => {
    const store = Store.open(":memory:");
    const value = { taskId: "task-1", startedAt: "2026-11-04T00:00:00.000Z" };
    store.setState("relay", value);
    expect(store.getState<typeof value>("relay")).toEqual(value);
  });

  it("keeps a value across a close and reopen of the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");

    const first = Store.open(dbPath);
    first.setState("relay", { taskId: "task-1", startedAt: NOW });
    first.close();

    const reopened = Store.open(dbPath);
    expect(reopened.getState<{ taskId: string; startedAt: string }>("relay")).toEqual({
      taskId: "task-1",
      startedAt: NOW,
    });
    reopened.close();
  });

  it("migrates a version-1 database to version 2 and adds the state table", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");

    const first = Store.open(dbPath);
    first.close();

    const raw = new DatabaseSync(dbPath);
    raw.exec("DROP TABLE state");
    raw.exec("UPDATE schema_version SET version = 1");
    raw.close();

    const migrated = Store.open(dbPath);
    migrated.setState("relay", { taskId: "task-1" });
    expect(migrated.getState<{ taskId: string }>("relay")).toEqual({ taskId: "task-1" });
    migrated.close();
  });
});

describe("Store (transcript)", () => {
  it("keeps a task's lines in order, with tool statuses and secrets redacted", () => {
    const store = Store.open(":memory:", { secrets: { key: "sk-secret-123456" } });
    store.addTranscript("t1", "prompt", "Fix the test");
    store.addTranscript("t1", "tool", "npm test", { id: "c1", status: "pending" });
    store.addTranscript("t2", "agent", "other task");
    store.addTranscript("t1", "agent", "Used sk-secret-123456 to log in");
    store.setToolStatus("t1", "c1", "completed");
    const lines = store.transcript("t1");
    expect(lines.map((l) => [l.role, l.text, l.status])).toEqual([
      ["prompt", "Fix the test", undefined],
      ["tool", "npm test", "completed"],
      ["agent", expect.not.stringContaining("sk-secret-123456"), undefined],
    ]);
  });

  it("adds the transcript table to a version-2 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");
    Store.open(dbPath).close();
    const raw = new DatabaseSync(dbPath);
    raw.exec("DROP TABLE transcript");
    raw.exec("UPDATE schema_version SET version = 2");
    raw.close();
    const migrated = Store.open(dbPath);
    migrated.addTranscript("t1", "note", "hello");
    expect(migrated.transcript("t1")).toHaveLength(1);
    migrated.close();
  });
});

describe("Store (tasks, ADR 0039)", () => {
  const task = {
    id: "t1",
    title: "Fix the build",
    project: "app",
    agent: "Pi · deepseek/deepseek-flash",
    model: "deepseek/deepseek-flash",
    stage: "done" as const,
    lastReport: "Fixed",
    startedAt: "2026-11-06T10:00:00.000Z",
    updatedAt: "2026-11-06T10:05:00.000Z",
    automaticDecisions: ["Allowed by rule r1: npm test"],
  };

  it("saves and reads tasks, newest first", () => {
    const store = Store.open(":memory:");
    store.saveTask({ task, cwd: "/p/app", profileId: "pi", failed: false, agentSessionId: "pi-1" });
    store.saveTask({
      task: { ...task, id: "t2", updatedAt: "2026-11-06T11:00:00.000Z", model: undefined as never },
      cwd: "/p/app",
      profileId: "dsh",
      failed: true,
      endedAt: "2026-11-06T11:00:00.000Z",
      endedWhy: "AgentHerd stopped",
    });
    expect(store.tasks().map((t) => t.task.id)).toEqual(["t2", "t1"]);
    expect(store.task("t1")).toEqual({
      task,
      cwd: "/p/app",
      profileId: "pi",
      failed: false,
      agentSessionId: "pi-1",
    });
    expect(store.task("t2")).toMatchObject({ failed: true, endedWhy: "AgentHerd stopped" });
    store.close();
  });

  it("adds the tasks table to a version-5 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");
    Store.open(dbPath).close();
    const raw = new DatabaseSync(dbPath);
    raw.exec("DROP TABLE tasks");
    raw.exec("UPDATE schema_version SET version = 5");
    raw.close();
    const migrated = Store.open(dbPath);
    migrated.saveTask({ task, cwd: "/p", profileId: "pi", failed: false });
    expect(migrated.tasks()).toHaveLength(1);
    migrated.close();
  });
});

describe("Store (herder_log)", () => {
  const m = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });

  it("keeps the Herder's whole conversation and rewrites only from the first change", () => {
    const store = Store.open(":memory:");
    store.writeHerderLog(0, [m("a"), m("b"), m("c")]);
    store.writeHerderLog(2, [m("c2"), m("d")]);
    expect(store.herderLog()).toEqual([m("a"), m("b"), m("c2"), m("d")]);
    store.writeHerderLog(1, []);
    expect(store.herderLog()).toEqual([m("a")]);
    store.close();
  });

  it("moves the tail a version-7 database kept in state into the log", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");
    const old = Store.open(dbPath);
    old.setState("herder.messages", [m("a"), m("b")]);
    old.close();
    const raw = new DatabaseSync(dbPath);
    dropHerderTables(raw);
    raw.exec("UPDATE schema_version SET version = 7");
    raw.close();
    const migrated = Store.open(dbPath);
    expect(migrated.herderLog()).toEqual([m("a"), m("b")]);
    expect(migrated.getState("herder.messages")).toBeUndefined();
    migrated.close();
  });
});

describe("Store (audit by kind prefix)", () => {
  it("gives the newest rows of the kinds that start with a prefix, oldest first", () => {
    const store = Store.open(":memory:");
    store.audit("herder.turn", { kind: "owner" });
    store.audit("item.decided", { id: "x" });
    store.audit("herder.error", { message: "boom" });
    store.audit("herder.retry", { delay: 1 });
    expect(store.auditRowsLike("herder.", 2).map((r) => [r.kind, r.data])).toEqual([
      ["herder.error", { message: "boom" }],
      ["herder.retry", { delay: 1 }],
    ]);
    // A % or _ in the prefix is taken as it is, not as a pattern.
    expect(store.auditRowsLike("herder%", 10)).toEqual([]);
    store.close();
  });
});

describe("Store (herder_turns)", () => {
  it("keeps the Herder's conversation and finds Chinese words in it", () => {
    const store = Store.open(":memory:");
    store.addHerderTurn("owner", "以后报告都用中文，三行以内");
    store.addHerderTurn("answer", "/tmp/demo");
    store.addHerderTurn("herder", "好的");
    expect(store.herderTurns().map((t) => t.role)).toEqual(["owner", "answer", "herder"]);
    expect(store.searchHerderTurns("报告用中文").map((t) => t.text)).toEqual([
      "以后报告都用中文，三行以内",
    ]);
    expect(store.searchHerderTurns("好")).toEqual([]);
    store.close();
  });
});

describe("Store (owner_cards, ADR 0072)", () => {
  const report = (body: string): ReportView => ({
    kind: "report",
    taskId: "t1",
    result: "done",
    title: "修登录 401",
    body,
    summarized: false,
    automaticDecisions: [],
  });

  it("keeps each card in its latest form, oldest first, without secrets", () => {
    const store = Store.open(":memory:", { secrets: { key: "sk-secret-123" } });
    store.putOwnerCard("feishu:m1", report("在做"), "t1");
    store.putOwnerCard("feishu:m2", { kind: "ask", askId: "a1", text: "用哪个？", options: [] });
    store.putOwnerCard("feishu:m1", report("做完了，密钥 sk-secret-123 已换"));
    const cards = store.ownerCards();
    expect(cards.map((c) => c.ref)).toEqual(["feishu:m1", "feishu:m2"]);
    expect(cards[0]?.taskId).toBe("t1");
    expect(cards[0]?.view).toMatchObject({ kind: "report", body: "做完了，密钥 «redacted» 已换" });
    expect(cards[1]?.taskId).toBeUndefined();
    expect(store.ownerCards(1).map((c) => c.ref)).toEqual(["feishu:m2"]);
    expect(store.ownerCards(10, "2999-01-01T00:00:00.000Z")).toEqual([]);
    store.close();
  });

  it("keeps only the newest cards", () => {
    const store = Store.open(":memory:");
    for (let i = 0; i < OWNER_CARDS_KEEP + 3; i++) store.putOwnerCard(`f:${i}`, report(String(i)));
    const cards = store.ownerCards(OWNER_CARDS_KEEP + 10);
    expect(cards).toHaveLength(OWNER_CARDS_KEEP);
    expect(cards.at(-1)?.ref).toBe(`f:${OWNER_CARDS_KEEP + 2}`);
    store.close();
  });

  it("adds the table to a version-14 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");
    Store.open(dbPath).close();
    const raw = new DatabaseSync(dbPath);
    raw.exec("DROP TABLE owner_cards");
    raw.exec("UPDATE schema_version SET version = 14");
    raw.close();
    const migrated = Store.open(dbPath);
    migrated.putOwnerCard("f:1", report("ok"));
    expect(migrated.ownerCards()).toHaveLength(1);
    migrated.close();
  });
});

describe("Store (herder_requests, ADR 0093)", () => {
  const parts = { system: 10, memory: 1, tools: 5, owner: 2, herder: 3, results: 4, folds: 0 };
  const req = (at: string, input = 100) => ({
    at,
    model: "deepseek/deepseek-flash",
    input,
    output: 20,
    cacheRead: 900,
    cacheWrite: 0,
    tokens: 25,
    parts,
  });

  it("keeps each request's numbers and gives those since a time, oldest first", () => {
    const store = Store.open(":memory:");
    store.addHerderRequest(req("2026-11-20T10:00:00.000Z", 1));
    store.addHerderRequest(req("2026-11-21T10:00:00.000Z", 2));
    store.addHerderRequest(req("2026-11-21T11:00:00.000Z", 3));
    const since = store.herderRequests("2026-11-21T00:00:00.000Z");
    expect(since.map((r) => r.input)).toEqual([2, 3]);
    expect(since[0]).toEqual({ ...req("2026-11-21T10:00:00.000Z", 2), cost: 0 });
    expect(store.herderRequests("2026-11-01T00:00:00.000Z", 1).map((r) => r.input)).toEqual([3]);
    store.close();
  });

  it("keeps where each request sits, what it cost and the prompt it went with (ADR 0095)", () => {
    const store = Store.open(":memory:");
    store.addHerderRequest({
      ...req(NOW),
      seq: 7,
      round: 4,
      cost: 0.002,
      window: 128_000,
      prompt: "abc",
      failed: true,
    });
    const { parts: _, ...bare } = req(NOW);
    store.addHerderRequest(bare);
    expect(store.herderRequests(NOW)).toEqual([
      { ...req(NOW), seq: 7, round: 4, cost: 0.002, window: 128_000, prompt: "abc", failed: true },
      { ...bare, cost: 0 },
    ]);
    store.close();
  });

  it("adds the table to a version-15 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");
    Store.open(dbPath).close();
    const raw = new DatabaseSync(dbPath);
    dropHerderTables(raw);
    raw.exec(HERDER_LOG_TABLE_SQL);
    raw.exec("UPDATE schema_version SET version = 15");
    raw.close();
    const migrated = Store.open(dbPath);
    migrated.addHerderRequest(req(NOW));
    expect(migrated.herderRequests(NOW)).toHaveLength(1);
    migrated.close();
  });
});

/** Takes a new herd.db back to before schema 17: no herder_* tables but the turns. */
function dropHerderTables(raw: DatabaseSync): void {
  for (const t of [
    "herder_messages",
    "herder_rounds",
    "herder_requests",
    "herder_folds",
    "herder_events",
    "herder_prompts",
  ]) {
    raw.exec(`DROP TABLE IF EXISTS ${t}`);
  }
}

describe("Store (the Herder's conversation in herd.db, ADR 0095)", () => {
  const at = (minute: number) =>
    Date.parse(`2026-11-21T10:${String(minute).padStart(2, "0")}:00.000Z`);
  const owner = (text: string, minute: number) => ({
    role: "user",
    content: [
      { type: "text", text: `[Now: 2026-11-21 18:${minute}, Friday]\n[Owner's message]\n${text}` },
    ],
    timestamp: at(minute),
  });
  const reply = (text: string, minute: number, usage = true) => ({
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "deepseek",
    model: "deepseek-flash",
    stopReason: "stop",
    timestamp: at(minute),
    ...(usage
      ? { usage: { input: 100, output: 20, cacheRead: 900, cacheWrite: 0, cost: { total: 0.001 } } }
      : {}),
  });
  const call = (minute: number) => ({
    role: "assistant",
    content: [{ type: "toolCall", id: "c1", name: "session_list", arguments: {} }],
    provider: "deepseek",
    model: "deepseek-flash",
    stopReason: "toolUse",
    timestamp: at(minute),
    usage: { input: 50, output: 5, cacheRead: 800, cacheWrite: 10 },
  });
  const result = (minute: number) => ({
    role: "toolResult",
    toolCallId: "c1",
    toolName: "session_list",
    content: [{ type: "text", text: "没有任务" }],
    timestamp: at(minute),
  });
  const task = (minute: number) => ({
    role: "user",
    content: [
      {
        type: "text",
        text: '[Now: x]\n[Task result, not from the owner]\nTask e55ca076 "修登录 401" finished its turn.\nThe agent\'s reply:\n好了',
      },
    ],
    timestamp: at(minute),
  });

  it("upgrades a version-16 database: messages with their kind and round, usage from the replies, a copy first", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentherd-core-"));
    const dbPath = join(dir, "herd.db");
    Store.open(dbPath).close();
    const log = [
      owner("现在什么情况？", 1),
      call(2),
      result(3),
      reply("没有任务在跑", 4),
      task(5),
      reply("修好了", 6, false),
    ];
    const raw = new DatabaseSync(dbPath);
    dropHerderTables(raw);
    raw.exec(HERDER_LOG_TABLE_SQL);
    raw.exec(HERDER_REQUESTS_V16_SQL);
    raw.exec(
      "INSERT INTO herder_requests(at, model, input, output, cache_read, cache_write, tokens, parts_json) VALUES ('x', 'm', 1, 1, 1, 1, 1, '{}')",
    );
    const insert = raw.prepare("INSERT INTO herder_log(seq, message_json) VALUES (?, ?)");
    for (const [i, m] of log.entries()) insert.run(i, JSON.stringify(m));
    raw.exec("UPDATE schema_version SET version = 16");
    raw.close();

    const store = Store.open(dbPath);
    expect(store.herderLog()).toEqual(log);
    expect(store.herder.messages().map((m) => [m.seq, m.kind, m.tool, m.round])).toEqual([
      [0, "owner", undefined, 0],
      [1, "call", "session_list", 0],
      [2, "result", "session_list", 0],
      [3, "reply", undefined, 0],
      [4, "task", undefined, 4],
      [5, "reply", undefined, 4],
    ]);
    expect(store.herder.messages()[0]?.at).toBe("2026-11-21T10:01:00.000Z");
    expect(store.herder.rounds()).toEqual([
      { seq: 0, at: "2026-11-21T10:01:00.000Z", kind: "owner", title: "现在什么情况？" },
      {
        seq: 4,
        at: "2026-11-21T10:05:00.000Z",
        kind: "task",
        title: "「修登录 401」finished its turn",
      },
    ]);
    // The old request rows go; every reply that carries usage becomes one.
    const requests = store.herderRequests("2000-01-01");
    expect(requests.map((r) => [r.seq, r.round, r.tokens, r.cost])).toEqual([
      [1, 0, 860, 0],
      [3, 0, 1000, 0.001],
    ]);
    expect(requests[0]?.parts).toBeUndefined();
    const tables = new DatabaseSync(dbPath)
      .prepare("SELECT name FROM sqlite_master WHERE name = 'herder_log'")
      .all();
    expect(tables).toEqual([]);
    expect(readdirSync(dir).filter((f) => /^herd\.db\.v16-.*\.bak$/.test(f))).toHaveLength(1);
    store.close();
  });

  it("starts a round at each prompt and rewrites rounds with the messages", () => {
    const store = Store.open(":memory:");
    store.writeHerderLog(0, [owner("甲", 1), reply("好", 2), owner("乙", 3), reply("行", 4)]);
    store.writeHerderLog(3, [call(5), result(6), reply("查完了", 7)]);
    expect(store.herder.messages().map((m) => m.round)).toEqual([0, 0, 2, 2, 2, 2]);
    store.writeHerderLog(2, []);
    expect(store.herder.rounds().map((r) => r.title)).toEqual(["甲"]);
    // A message without a time takes the one before it.
    store.writeHerderLog(2, [{ role: "user", content: "丙" }]);
    expect(store.herder.messages()[2]?.at).toBe("2026-11-21T10:02:00.000Z");
    store.close();
  });

  it("saves the bookkeeping and the folds together, and never deletes a fold", () => {
    const store = Store.open(":memory:");
    const fold = (id: string, state: "active" | "merged", parent?: string) => ({
      blockId: id,
      ...(parent === undefined ? {} : { parent }),
      level: parent === undefined ? 2 : 1,
      state,
      by: "herder" as const,
      topic: `话题 ${id}`,
      summary: `摘要 ${id}`,
      startSeq: 0,
      endSeq: 9,
      directStart: 0,
      directEnd: 9,
      messages: 10,
      callSeq: 12,
      tokensBefore: 5000,
      tokensAfter: 300,
      createdAt: NOW,
      updatedAt: NOW,
      block: { blockId: id },
    });
    store.saveHerderContext("herder.context", { refs: 1 }, [fold("b1", "active")]);
    store.saveHerderContext("herder.context", { refs: 2 }, [
      fold("b1", "merged", "b10"),
      fold("b10", "active"),
    ]);
    store.saveHerderContext("herder.context", { refs: 3 }, []);
    expect(store.getState("herder.context")).toEqual({ refs: 3 });
    expect(store.herderFolds()).toEqual([fold("b1", "merged", "b10"), fold("b10", "active")]);
    store.close();
  });

  it("keeps events, and each system prompt once", () => {
    const store = Store.open(":memory:");
    store.addHerderEvent("fold", { blockId: "b1" }, 4);
    store.addHerderEvent("start", { messages: 3 });
    expect(store.herderEvents("2000-01-01").map((e) => [e.kind, e.round, e.data])).toEqual([
      ["fold", 4, { blockId: "b1" }],
      ["start", undefined, { messages: 3 }],
    ]);
    const tools = [{ name: "session_list" }];
    store.putHerderPrompt({ hash: "h1", system: "系统提示词", tools, tokens: 5 });
    store.putHerderPrompt({ hash: "h1", system: "不会改", tools: [], tokens: 9 });
    expect(store.herder.prompt("h1")).toMatchObject({ system: "系统提示词", tools, tokens: 5 });
    expect(store.herder.prompt()?.hash).toBe("h1");
    for (let i = 0; i < HERDER_PROMPTS_KEEP + 5; i++)
      store.putHerderPrompt({ hash: `p${i}`, system: String(i), tools: [], tokens: 1 });
    expect(store.herder.prompt()?.hash).toBe(`p${HERDER_PROMPTS_KEEP + 4}`);
    expect(store.herder.prompt("h1")).toBeUndefined();
    store.close();
  });
});
