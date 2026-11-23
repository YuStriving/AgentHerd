import { CASE_JOB, LESSON_JOB, REVIEW_JOB, Store } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_SYSTEM,
  LESSON_SYSTEM,
  MemoryWorker,
  parseJson,
  REVIEW_SYSTEM,
  REVIEW_TURNS,
} from "../src/memory-jobs.ts";

/** A memory model that answers each system prompt with the next scripted reply. */
function model(replies: Record<string, string[]>) {
  const asked: { system: string; user: string }[] = [];
  const complete = async (system: string, user: string) => {
    asked.push({ system, user });
    const next = replies[system]?.shift();
    if (next === undefined) throw new Error("unexpected request");
    return next;
  };
  return { asked, complete };
}

function setup(replies: Record<string, string[]>) {
  const store = Store.open(":memory:");
  const m = model(replies);
  const worker = new MemoryWorker({
    memory: store.memory,
    transcript: (id) => store.transcript(id),
    herderTurnsAfter: (id, n) => store.herderTurnsAfter(id, n),
    complete: m.complete,
  });
  return { store, worker, asked: m.asked };
}

const LESSON = JSON.stringify({
  skip: false,
  task_signature: "给 Electron 应用排查打包签名失败",
  lesson: "签名失败先看构建日志，别先重装依赖",
  evidence: "重装依赖白费了时间，日志里直接是证书过期",
});
const SIGNALS = ["the owner prompted it 1 more time(s) after the first"];

describe("parseJson", () => {
  it("reads JSON from a code fence", () => {
    expect(parseJson('好的\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJson("no")).toThrow("no JSON");
  });
});

describe("MemoryWorker", () => {
  it("a task picked for a lesson adds experience and no case (ADR 0054)", async () => {
    const { store, worker, asked } = setup({
      [LESSON_SYSTEM]: [LESSON],
      [EXPERIENCE_SYSTEM]: [
        JSON.stringify({
          action: "add",
          abstract: "签名失败先看构建日志",
          details: "比重装依赖快",
        }),
      ],
    });
    store.addTranscript("t1", "prompt", "打包失败了，看看");
    store.addTranscript("t1", "agent", "签名证书过期，已更新，打包成功");
    store.memory.enqueueJob(LESSON_JOB, {
      taskId: "t1",
      title: "pi-desktop：打包",
      cwd: "/u/pi-desktop",
      why: "done",
      signals: SIGNALS,
    });
    await worker.drain();
    expect(asked[0]?.user).toContain("签名证书过期");
    expect(asked[0]?.user).toContain("Picked because: the owner prompted it");
    expect(store.memory.list({ kinds: ["case"] })).toEqual([]);
    const lessons = store.memory.list({ kinds: ["experience"] });
    expect(lessons.map((r) => [r.abstract, r.scope, r.sourceRef])).toEqual([
      ["签名失败先看构建日志", "project:/u/pi-desktop", "t1"],
    ]);
    expect(store.memory.jobs()[0]?.state).toBe("done");

    // The same task again asks nothing.
    store.memory.enqueueJob(LESSON_JOB, { taskId: "t1", signals: SIGNALS });
    await worker.drain();
    expect(asked).toHaveLength(2);
  });

  it("an update in a second project makes the lesson global", async () => {
    const { store, worker } = setup({});
    const { ids } = store.memory.write(
      [
        {
          op: "add",
          kind: "experience",
          abstract: "打包签名失败先看构建日志",
          scope: "project:/u/a",
        },
      ],
      { actor: "task", source: "task" },
    );
    const id = (ids[0] as string).slice(0, 8);
    store.memory.enqueueJob(LESSON_JOB, { taskId: "t2", cwd: "/u/b", signals: SIGNALS });
    store.addTranscript("t2", "prompt", "打包签名失败");
    store.addTranscript("t2", "agent", "看了构建日志，修好了");
    (worker as unknown as { deps: { complete: unknown } }).deps.complete = model({
      [LESSON_SYSTEM]: [LESSON],
      [EXPERIENCE_SYSTEM]: [
        JSON.stringify({
          action: "update",
          id,
          abstract: "签名失败先看构建日志，两个项目都是这样",
          details: "",
        }),
      ],
    }).complete;
    await worker.drain();
    const lesson = store.memory.list({ kinds: ["experience"] });
    expect(lesson.map((r) => [r.abstract, r.scope])).toEqual([
      ["签名失败先看构建日志，两个项目都是这样", "global"],
    ]);
  });

  it("normalizes Windows drive letters in project scope keys without false global promotion", async () => {
    const { store, worker } = setup({});
    const { ids } = store.memory.write(
      [
        {
          op: "add",
          kind: "experience",
          abstract: "打包签名失败先看构建日志",
          scope: "project:G:\\code\\app",
        },
      ],
      { actor: "task", source: "task" },
    );
    const id = (ids[0] as string).slice(0, 8);
    store.memory.enqueueJob(LESSON_JOB, { taskId: "t3", cwd: "g:\\code\\app", signals: SIGNALS });
    store.addTranscript("t3", "prompt", "打包签名失败");
    store.addTranscript("t3", "agent", "看了构建日志，修好了");
    (worker as unknown as { deps: { complete: unknown } }).deps.complete = model({
      [LESSON_SYSTEM]: [LESSON],
      [EXPERIENCE_SYSTEM]: [
        JSON.stringify({
          action: "update",
          id,
          abstract: "签名失败先看构建日志",
          details: "",
        }),
      ],
    }).complete;
    await worker.drain();
    const lesson = store.memory.list({ kinds: ["experience"] });
    expect(lesson.map((r) => [r.abstract, r.scope])).toEqual([
      ["签名失败先看构建日志", "project:G:\\code\\app"],
    ]);
  });

  it("most picked tasks teach nothing; a bad reply retries later", async () => {
    const { store, worker } = setup({ [LESSON_SYSTEM]: ['{"skip": true}', "not json"] });
    for (const t of ["t1", "t2"]) {
      store.addTranscript(t, "prompt", "hi");
      store.addTranscript(t, "agent", "hello");
      store.memory.enqueueJob(LESSON_JOB, { taskId: t, signals: SIGNALS });
    }
    await worker.drain();
    expect(store.memory.list()).toEqual([]);
    expect(store.memory.jobs().map((j) => j.state)).toEqual(["pending", "done"]);
  });

  it("an old case job from before ADR 0054 asks no model", async () => {
    const { store, worker, asked } = setup({});
    store.addTranscript("t1", "prompt", "找 issue");
    store.addTranscript("t1", "agent", "9 个");
    store.memory.enqueueJob(CASE_JOB, { taskId: "t1", why: "done" });
    await worker.drain();
    expect(asked).toEqual([]);
    expect(store.memory.jobs()[0]?.state).toBe("done");
  });

  it("a review keeps only what passes the memory checks (ADR 0101)", async () => {
    const { store, worker, asked } = setup({
      [REVIEW_SYSTEM]: [
        JSON.stringify({
          operations: [
            {
              action: "add",
              kind: "owner",
              content: "主人希望报告三行以内",
              evidence: "报告三行以内",
            },
            // A decision lets steps run without asking: only the owner or the Herder keeps one.
            {
              action: "add",
              kind: "decision",
              content: "pi-desktop 不开 PR",
              evidence: "看下 pi-desktop",
            },
            { action: "add", kind: "person", content: "小王负责前端", evidence: "小王是我们前端" },
            { action: "add", kind: "project", content: "演示在 /tmp/demo", evidence: "/tmp/demo" },
            { action: "add", kind: "owner", content: "没有依据的猜测" },
          ],
        }),
      ],
    });
    store.addHerderTurn("owner", "报告三行以内。看下 pi-desktop");
    store.addHerderTurn("herder", "好的，小王是我们前端吗？");
    store.addHerderTurn("owner", "小王是我们前端");
    store.addHerderTurn("answer", "/tmp/demo");
    store.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    await worker.drain();
    expect(asked[0]?.user).toContain("[owner tapped] /tmp/demo");
    expect(asked[0]?.user).toContain("[secretary] 好的，小王是我们前端吗？");
    expect(
      store.memory
        .list()
        .map((r) => r.abstract)
        .sort(),
    ).toEqual(["主人希望报告三行以内", "小王负责前端"]);
    expect(store.memory.list().every((r) => r.source === "review")).toBe(true);
    expect(store.memory.lastLog("review.done")?.ref).toBe("4");
    expect(store.memory.logs().filter((l) => l.kind === "review.dropped")).toHaveLength(3);
  });

  it("keeps the lesson of a correction, from the secretary's side (ADR 0101)", async () => {
    const lesson = "推荐 issue 前，开着的和被关掉的 PR 都要看";
    const { store, worker, asked } = setup({
      [REVIEW_SYSTEM]: [
        JSON.stringify({
          operations: [
            {
              action: "add",
              kind: "experience",
              content: lesson,
              evidence: "主人指出 #2391 其实有被拒的 PR，我只看了开着的",
            },
          ],
        }),
      ],
    });
    store.addHerderTurn("herder", "#2391 和 #2426 都还没人接，适合上手");
    store.addHerderTurn("owner", "这个忽略吧，这个 issue 里面其实有 pr，只不过被拒绝了");
    store.addHerderTurn("herder", "明白，下次我连被关掉的 PR 也看");
    store.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    await worker.drain();
    expect(asked[0]?.system).toBe(REVIEW_SYSTEM);
    expect(store.memory.list({ kinds: ["experience"] }).map((r) => r.abstract)).toEqual([lesson]);
  });

  it("one topic, one entry: a changed fact replaces the kept one (ADR 0101)", async () => {
    const store0 = Store.open(":memory:");
    store0.memory.write([{ op: "add", kind: "owner", abstract: "主人希望报告用英文" }], {
      actor: "herder",
      source: "said",
    });
    const [kept] = store0.memory.list();
    if (kept === undefined) throw new Error("nothing kept");
    const m = model({
      [REVIEW_SYSTEM]: [
        JSON.stringify({
          operations: [
            {
              action: "replace",
              id: kept.id.slice(0, 8),
              content: "主人希望报告用中文",
              evidence: "报告还是用中文吧",
            },
            // The same words again are not a second entry.
            {
              action: "add",
              kind: "owner",
              content: "主人希望报告用中文",
              evidence: "报告还是用中文吧",
            },
          ],
        }),
      ],
    });
    const worker = new MemoryWorker({
      memory: store0.memory,
      transcript: (id) => store0.transcript(id),
      herderTurnsAfter: (id, n) => store0.herderTurnsAfter(id, n),
      complete: m.complete,
    });
    store0.addHerderTurn("owner", "报告还是用中文吧");
    store0.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    await worker.drain();
    // The review was shown what is kept on the topic, with its id.
    expect(m.asked[0]?.user).toContain(kept.id.slice(0, 8));
    expect(store0.memory.list().map((r) => r.abstract)).toEqual(["主人希望报告用中文"]);
    expect(
      store0.memory.logs().some((l) => l.kind === "review.dropped" && /already kept/.test(l.text)),
    ).toBe(true);
  });
});

describe("reviews catch up (ADR 0090)", () => {
  const NONE = JSON.stringify({ operations: [] });

  it("reads the conversation in order from where the last review stopped, chunk by chunk", async () => {
    const { store, worker, asked } = setup({ [REVIEW_SYSTEM]: [NONE, NONE, NONE] });
    for (let i = 1; i <= REVIEW_TURNS * 2 + 5; i++) store.addHerderTurn("owner", `第 ${i} 句`);
    store.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    await worker.drain();
    expect(asked).toHaveLength(3);
    expect(asked[0]?.user).toContain("[owner] 第 1 句");
    expect(asked[0]?.user).not.toContain(`第 ${REVIEW_TURNS + 1} 句`);
    expect(asked[1]?.user).toContain(`[owner] 第 ${REVIEW_TURNS + 1} 句`);
    expect(asked[2]?.user).toContain(`第 ${REVIEW_TURNS * 2 + 5} 句`);
    expect(store.memory.lastLog("review.done")?.ref).toBe(String(REVIEW_TURNS * 2 + 5));
  });

  it("an old job starts after the newest finished review, not before it", async () => {
    const { store, worker, asked } = setup({ [REVIEW_SYSTEM]: [NONE] });
    store.addHerderTurn("owner", "早就读过的");
    store.memory.log("review.done", "through turn 1", "1");
    store.addHerderTurn("owner", "还没读的");
    store.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    await worker.drain();
    expect(asked[0]?.user).not.toContain("早就读过的");
    expect(asked[0]?.user).toContain("还没读的");
  });

  it("on start, queues a review when the owner said things no review read", () => {
    const { store, worker } = setup({});
    store.addHerderTurn("owner", "我一般半夜写代码");
    store.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    const failed = store.memory.claimJob();
    if (failed === undefined) throw new Error("no job");
    for (let i = 0; i < 4; i++) store.memory.failJob(failed.id, "Request timed out.");
    worker.catchUp();
    const pending = store.memory.jobs().filter((j) => j.state === "pending");
    expect(pending.map((j) => j.kind)).toEqual([REVIEW_JOB]);
    worker.catchUp();
    expect(store.memory.jobs().filter((j) => j.state === "pending")).toHaveLength(1);
  });
});

describe("reviews keep the owner's profile card (ADR 0091)", () => {
  it("keeps facts said in passing on the card and replaces a field that changed", async () => {
    const add = (content: string, evidence: string) => ({
      action: "add",
      kind: "profile",
      content,
      evidence,
    });
    const { store, worker, asked } = setup({
      [REVIEW_SYSTEM]: [
        JSON.stringify({
          operations: [
            add("称呼：火哥", "叫我火哥"),
            add("作息：常写代码到半夜", "我一般半夜还在写代码"),
            { action: "add", kind: "decision", content: "不做 Windows 版", evidence: "叫我火哥" },
          ],
        }),
        JSON.stringify({ operations: [add("作息：最近早睡", "这周开始早睡了")] }),
      ],
    });
    store.addHerderTurn("owner", "叫我火哥，我一般半夜还在写代码");
    store.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    await worker.drain();
    expect(asked[0]?.system).toContain("profile: the owner's profile card");
    const card = () =>
      store.memory
        .list({ kinds: ["profile"] })
        .map((r) => r.abstract)
        .sort();
    expect(card()).toEqual(["作息：常写代码到半夜", "称呼：火哥"]);
    expect(store.memory.list({ kinds: ["decision"] })).toHaveLength(0);

    store.addHerderTurn("owner", "这周开始早睡了");
    store.memory.enqueueJob(REVIEW_JOB, { afterId: 0 });
    await worker.drain();
    expect(asked[1]?.user).toContain("[profile] 称呼：火哥");
    expect(card()).toEqual(["作息：最近早睡", "称呼：火哥"]);
  });
});
