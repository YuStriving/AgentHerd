// The Herder's herd-ui blocks (ADR 0074): taught in the system prompt, repaired before sending,
// and a block that cannot be read gets one rewrite in the same turn.

import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  registerFauxProvider,
  streamSimple,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { herdUiFixPrompt, herdUiPrompt } from "../src/herd-ui-prompt.ts";
import { Herder } from "../src/herder.ts";
import { fakeHost } from "./helpers.ts";

let faux: FauxProviderRegistration[] = [];
afterEach(() => {
  for (const f of faux) f.unregister();
  faux = [];
});

function setup() {
  const registration = registerFauxProvider();
  faux.push(registration);
  const { host, rec } = fakeHost();
  const herder = new Herder({
    host,
    model: registration.getModel(),
    streamFn: streamSimple,
    sleep: async () => {},
  });
  return { herder, rec, faux: registration };
}

const GOOD =
  '两个都还活跃：\n\n```herd-ui\n{"items":[{"type":"table","columns":["仓库","星"],"rows":[["a","1"]]}]}\n```';

describe("herd-ui in the Herder (ADR 0074)", () => {
  it("teaches the components in the system prompt", async () => {
    const { herder, rec, faux } = setup();
    let system = "";
    faux.setResponses([
      (context) => {
        const first = context.messages[0] as { content: unknown } | undefined;
        system =
          typeof first?.content === "string" ? first.content : JSON.stringify(first?.content);
        return fauxAssistantMessage("好");
      },
    ]);
    herder.ownerMessage("在吗");
    await herder.idle();
    expect(system).toContain(herdUiPrompt());
    for (const type of ["table", "stats", "steps", "choices", "link", "file"]) {
      expect(system).toContain(`"type":"${type}"`);
    }
    // The pet offers 打开 only for file items, so the Herder is told a path in words stays text
    // and that it picks which files matter (owner, m22988).
    expect(system).toContain("Only a file item gets an 打开 button");
    // A picture to look at is shown, not named by its path (ADR 0075).
    expect(system).toContain("![飞书邮箱授权码](/tmp/lark-mail-auth.png)");
    expect(system).toContain("Do it also when a task's message only");
    expect(rec.said).toEqual(["好"]);
  });

  it("sends a readable block repaired, without a rewrite", async () => {
    const { herder, rec, faux } = setup();
    // A trailing comma and a bare key: the parser repairs them.
    const sloppy = '看这个：\n\n```herd-ui\n{items:[{"type":"list","items":["a","b",]}]}\n```';
    faux.setResponses([fauxAssistantMessage(sloppy)]);
    herder.ownerMessage("列一下");
    await herder.idle();
    expect(rec.said).toHaveLength(1);
    expect(rec.said[0]).toContain('"type":"list"');
    expect(rec.said[0]).not.toContain("items:[");
    expect(rec.turns.at(-1)).toEqual({ role: "herder", text: rec.said[0] });
    expect(rec.audits.map((a) => a.type)).not.toContain("herder.ui.rewrite");
  });

  it("tells a task's result with a repaired block instead of dropping it (ADR 0075)", async () => {
    const { herder, rec, faux } = setup();
    // Spaces in the JSON: the block goes out normalized, which once made the voice give up.
    const reply =
      '装好了，截图在下面。\n\n```herd-ui\n{ "items": [ { "type": "image", "path": "/tmp/shot.png", "title": "截图" } ] }\n```';
    faux.setResponses([fauxAssistantMessage(reply)]);
    const said = await herder.voice({
      kind: "report",
      taskId: "t-1",
      title: "启动 magpie",
      result: "done",
      reply: "截图在 /tmp/shot.png",
    });
    expect(said).toContain('{"items":[{"type":"image","path":"/tmp/shot.png","title":"截图"}]}');
    expect(rec.turns.at(-1)).toEqual({ role: "herder", text: said });
  });

  it("a block that cannot be read is written again once, in the same turn", async () => {
    const { herder, rec, faux } = setup();
    const seen: string[] = [];
    faux.setResponses([
      fauxAssistantMessage(
        '两个都还活跃：\n\n```herd-ui\n{"items": [{"type":"chart","data":[1,2]}]}\n```',
      ),
      (context) => {
        seen.push(JSON.stringify(context.messages.at(-1)?.content));
        return fauxAssistantMessage(GOOD);
      },
    ]);
    herder.ownerMessage("看看这两个仓库");
    await herder.idle();
    expect(seen[0]).toContain("not from the owner");
    expect(rec.said).toEqual([
      GOOD.replace(/\{"items".*\}/s, (j) => JSON.stringify(JSON.parse(j))),
    ]);
    expect(rec.audits.find((a) => a.type === "herder.ui.rewrite")?.data).toMatchObject({
      fixed: true,
    });
  });

  it("when the rewrite fails too, the words go without the block", async () => {
    const { herder, rec, faux } = setup();
    const broken = '两个都还活跃。\n\n```herd-ui\n{"items": [{"type":"chart","data":[1,2]}]}\n```';
    faux.setResponses([fauxAssistantMessage(broken), fauxAssistantMessage(broken)]);
    herder.ownerMessage("看看这两个仓库");
    await herder.idle();
    expect(rec.said).toEqual(["两个都还活跃"]);
    expect(rec.audits.find((a) => a.type === "herder.ui.rewrite")?.data).toMatchObject({
      fixed: false,
    });
  });

  it("the note asking for a rewrite lists what was wrong", () => {
    const note = herdUiFixPrompt(["fence 1: not valid JSON; write one JSON object"]);
    expect(note).toContain("[From AgentHerd, not from the owner]");
    expect(note).toContain("- fence 1: not valid JSON");
  });
});
