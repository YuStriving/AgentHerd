// E2E-TASK-WAIT-ASK (ADR 0081): a task that waits on the owner for half an hour is asked about
// once — 「还要做 / 不做了」 — and stopped when nobody answers for a day. Stopping a task that
// already ended while it waited makes it stop waiting.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StdioMcpServer } from "@agentherd/acp-client";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AgentProfile, AskView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import { Store } from "../../src/store.ts";
import { WAIT_TARGET, waitedFor } from "../../src/waiting.ts";

const BIN = fileURLToPath(new URL("../../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-wait-"));
let herds: Herd[] = [];

afterEach(async () => {
  for (const h of herds) await h.stop();
  herds = [];
});

const TWO_TURNS = `
turns:
  - - sleep: 200
    - message: "Open the sign-in link."
    - end_turn: end_turn
  - - message: "New link sent."
    - end_turn: end_turn
`;

function profile(): AgentProfile {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, TWO_TURNS);
  return {
    id: "mock",
    name: "Mock",
    command: [process.execPath, BIN, "--script", file],
    env: {},
    exporter: null,
  };
}

async function setup(store = Store.open(":memory:"), clock = new FakeClock()) {
  const tokens: string[] = [];
  const prompts: string[] = [];
  const channel = new FakeChannel("owner");
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles: [profile()],
    store,
    clock,
    boardDebounceMs: 10,
    mcpServer: (token): StdioMcpServer => {
      tokens.push(token);
      return { name: "agentherd", command: "relay", args: [], env: [{ name: "T", value: token }] };
    },
  });
  herds.push(herd);
  await herd.start();
  return { herd, tokens, prompts, channel, clock, store };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

const waiting = { state: "waiting", summary: "open the sign-in link within 10 minutes" };

/** Starts a task whose agent says it waits on the owner. */
async function waitingTask(s: Awaited<ReturnType<typeof setup>>) {
  const { taskId, turn } = await s.herd.startTask("mock", dir, "Read the mail");
  await until(() => s.tokens.length > 0);
  await s.herd.mcp(s.tokens[0] as string, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "herd_report", arguments: waiting },
  });
  await turn;
  return taskId;
}

const asks = (channel: FakeChannel) =>
  channel.ofKind("ask").filter((m) => m.view.askId.startsWith(WAIT_TARGET));
/** The first question about a waiting task, as it looks now. */
const firstAsk = (channel: FakeChannel): AskView => {
  const ask = asks(channel)[0];
  if (ask === undefined) throw new Error("no question was asked");
  return ask.view;
};

describe("E2E-TASK-WAIT-ASK (ADR 0081)", () => {
  it("asks once after half an hour; 还要做 sends the task back to work", async () => {
    const s = await setup();
    const taskId = await waitingTask(s);
    const task = () => s.herd.tasks().find((t) => t.id === taskId);
    expect(task()?.stage).toBe("needs-owner");
    await s.herd.checkWaiting();
    expect(asks(s.channel)).toEqual([]);
    await s.clock.advance(31 * 60_000);
    await s.herd.checkWaiting();
    await s.herd.checkWaiting();
    expect(asks(s.channel)).toHaveLength(1);
    const ask = firstAsk(s.channel);
    // The minute check found it at 30 or 31 minutes.
    expect(ask.text).toMatch(/^"Read the mail" has waited for you for 3[01] min:/);
    expect(ask.text).toContain("open the sign-in link within 10 minutes");
    expect(ask.options.map((o) => o.label)).toEqual(["Keep going", "Drop it"]);
    await s.channel.tap(ask.askId, "keep");
    await until(() => task()?.stage === "done");
    expect(task()?.stage).toBe("done");
    expect(firstAsk(s.channel).final).toBe("Keep going");
  });

  it("不做了 stops the task, and it no longer waits", async () => {
    const s = await setup();
    const taskId = await waitingTask(s);
    await s.clock.advance(31 * 60_000);
    await s.herd.checkWaiting();
    const ask = firstAsk(s.channel);
    await s.channel.tap(ask.askId, "drop");
    const task = s.herd.tasks().find((t) => t.id === taskId);
    expect(task?.stage).toBe("failed");
    expect(task?.lastReport).toBe("the owner said it is finished");
    expect(firstAsk(s.channel).final).toBe("Drop it");
    await s.clock.advance(31 * 60_000);
    await s.herd.checkWaiting();
    expect(asks(s.channel)).toHaveLength(1);
  });

  it("stops the task when nobody answers for a day", async () => {
    const s = await setup();
    const taskId = await waitingTask(s);
    await s.clock.advance(31 * 60_000);
    await s.herd.checkWaiting();
    await s.clock.advance(23 * 3_600_000);
    await s.herd.checkWaiting();
    expect(s.herd.tasks().find((t) => t.id === taskId)?.stage).toBe("needs-owner");
    await s.clock.advance(2 * 3_600_000);
    await s.herd.checkWaiting();
    const task = s.herd.tasks().find((t) => t.id === taskId);
    expect(task?.stage).toBe("failed");
    expect(task?.lastReport).toBe("it waited a day for the owner without an answer");
    expect(firstAsk(s.channel).final).toBe("No answer for a day; the task stopped");
  });

  it("asks at once after a restart about a task that waited before it", async () => {
    const store = Store.open(":memory:");
    const clock = new FakeClock();
    const first = await setup(store, clock);
    const taskId = await waitingTask(first);
    await first.herd.endTask(taskId, "no prompt for 60 minutes");
    expect(first.herd.tasks().find((t) => t.id === taskId)?.stage).toBe("needs-owner");
    await first.herd.stop();
    herds = herds.filter((h) => h !== first.herd);
    await clock.advance(5 * 3_600_000);
    const second = await setup(store, clock);
    await second.herd.checkWaiting();
    expect(asks(second.channel)).toHaveLength(1);
    expect(firstAsk(second.channel).text).toContain("for 5 h");
    // The pet's 停止 on such a task now makes it stop waiting.
    await second.herd.stopTask(taskId);
    expect(second.herd.tasks().find((t) => t.id === taskId)?.stage).toBe("failed");
    await second.herd.checkWaiting();
    expect(firstAsk(second.channel).final).toBe("Already handled");
  });

  it("says how long in the owner's words", () => {
    const units = { minute: "分钟", hour: "小时", day: "天" };
    expect(waitedFor(10_000, units)).toBe("1 分钟");
    expect(waitedFor(45 * 60_000, units)).toBe("45 分钟");
    expect(waitedFor(3 * 3_600_000 + 5 * 60_000, units)).toBe("3 小时");
    expect(waitedFor(50 * 3_600_000, units)).toBe("2 天");
  });
});
