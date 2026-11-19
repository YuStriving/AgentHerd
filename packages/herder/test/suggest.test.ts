// What the owner might say next (ADR 0084): one hidden request after a reply, the way Codex does
// it — the last request as sent, the reply, one instruction more — and nothing of it kept.

import type { TranscriptContext } from "@earendil-works/pi-ai";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  registerFauxProvider,
  streamSimple,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { Herder } from "../src/herder.ts";
import {
  filterSuggestion,
  SUGGEST_MAX_TOKENS,
  sampleSuggestion,
  suggestInstruction,
} from "../src/suggest.ts";
import { fakeHost } from "./helpers.ts";

let faux: FauxProviderRegistration[] = [];
afterEach(() => {
  for (const f of faux) f.unregister();
  faux = [];
});

function setup(on = true) {
  const registration = registerFauxProvider();
  faux.push(registration);
  const { host, rec } = fakeHost();
  const shown: string[] = [];
  host.suggestion = { on: () => on, show: (text) => shown.push(text) };
  const herder = new Herder({
    host,
    model: registration.getModel(),
    streamFn: streamSimple,
    sleep: async () => {},
  });
  return { herder, rec, faux: registration, shown };
}

const textOf = (context: TranscriptContext): string[] =>
  context.messages.map((m) =>
    typeof m.content === "string"
      ? m.content
      : (m.content as { type: string; text?: string }[])
          .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
          .join(""),
  );

describe("filterSuggestion (ADR 0084)", () => {
  it("keeps a line the owner could send as it is", () => {
    expect(filterSuggestion("把第二个也下载下来")).toBe("把第二个也下载下来");
    expect(filterSuggestion("「接着做」")).toBe("接着做");
    expect(filterSuggestion("提交 PR 吧。")).toBe("提交 PR 吧");
    expect(filterSuggestion("继续")).toBe("继续");
    expect(filterSuggestion("open a pull request")).toBe("open a pull request");
    expect(filterSuggestion("yes")).toBe("yes");
  });

  it("drops silence, questions, praise, the Herder's voice and anything long", () => {
    for (const raw of [
      "",
      "无",
      "没有建议",
      "no suggestion",
      "建议：先合并",
      "要不要先合并？",
      "谢谢，辛苦了",
      "不错",
      "我来看看日志",
      "让我查一下",
      "Let me check the logs",
      "第一行\n第二行",
      "- 合并",
      "**合并**",
      "（先合并）",
      "啊",
      "merge",
      "这是一句非常非常长的话，长到主人根本不会这样打字，因为它超过了四十个字的上限而且还在继续",
      "one two three four five six seven eight nine ten eleven twelve thirteen",
    ]) {
      expect(filterSuggestion(raw), raw).toBeUndefined();
    }
  });
});

describe("sampleSuggestion (ADR 0084)", () => {
  it("asks for a short line with no tools and gives up after the timeout", async () => {
    const registration = registerFauxProvider();
    faux.push(registration);
    let options: { maxTokens?: number; toolChoice?: string } | undefined;
    let last = "";
    registration.setResponses([
      (context, opts) => {
        options = opts;
        last = textOf(context).at(-1) ?? "";
        return fauxAssistantMessage("把日志发我");
      },
    ]);
    const model = registration.getModel();
    const got = await sampleSuggestion({
      streamFn: streamSimple,
      model,
      messages: [{ role: "user", content: "在吗", timestamp: 1 }],
      locale: "zh-CN",
      signal: new AbortController().signal,
    });
    expect(got).toBe("把日志发我");
    expect(options?.maxTokens).toBe(SUGGEST_MAX_TOKENS);
    expect(options?.toolChoice).toBe("none");
    expect(last).toBe(suggestInstruction("zh-CN"));

    registration.setResponses([
      () => new Promise((done) => setTimeout(() => done(fauxAssistantMessage("太晚了")), 200)),
    ]);
    const late = await sampleSuggestion({
      streamFn: streamSimple,
      model,
      messages: [{ role: "user", content: "在吗", timestamp: 1 }],
      locale: "zh-CN",
      signal: new AbortController().signal,
      timeoutMs: 20,
    });
    expect(late).toBeUndefined();
  });
});

describe("the Herder suggests the owner's next message (ADR 0084)", () => {
  it("not after the first reply; after the second, from the same request plus one line", async () => {
    const { herder, rec, faux, shown } = setup();
    const requests: string[][] = [];
    const record = (reply: string) => (context: TranscriptContext) => {
      requests.push(textOf(context));
      return fauxAssistantMessage(reply);
    };
    faux.setResponses([record("在的。")]);
    herder.ownerMessage("在吗");
    await herder.idle();
    expect(shown).toEqual([]);
    expect(requests).toHaveLength(1);

    faux.setResponses([record("找到了两个仓库：a 和 b。"), record("把 b 下载下来")]);
    herder.ownerMessage("搜一下 magpie");
    await herder.idle();
    expect(shown).toEqual(["把 b 下载下来"]);
    expect(requests).toHaveLength(3);
    const [turn, hidden] = requests.slice(1) as [string[], string[]];
    // The same request the turn sent, its reply, then the instruction.
    expect(hidden.slice(0, turn.length)).toEqual(turn);
    expect(hidden.at(-2)).toBe("找到了两个仓库：a 和 b。");
    expect(hidden.at(-1)).toBe(suggestInstruction("zh-CN"));
    // Nothing of it is kept in the conversation.
    expect(JSON.stringify(rec.log)).not.toContain("建议模式");
    expect(JSON.stringify(rec.log)).not.toContain("把 b 下载下来");
    expect(rec.audits.some((a) => a.type === "herder.suggestion" && a.data.shown === true)).toBe(
      true,
    );
  });

  it("not when the reply offers answers, nor when the owner turned it off", async () => {
    const { herder, faux, shown } = setup();
    faux.setResponses([fauxAssistantMessage("在的。")]);
    herder.ownerMessage("在吗");
    await herder.idle();
    faux.setResponses([
      fauxAssistantMessage(
        '选一个：\n\n```herd-ui\n{"items":[{"type":"choices","question":"用哪个？","options":["a","b"]}]}\n```',
      ),
      fauxAssistantMessage("用 a"),
    ]);
    herder.ownerMessage("搜一下 magpie");
    await herder.idle();
    expect(shown).toEqual([]);
    expect(faux.getPendingResponseCount()).toBe(1);

    const off = setup(false);
    off.faux.setResponses([fauxAssistantMessage("一"), fauxAssistantMessage("二")]);
    off.herder.ownerMessage("甲");
    await off.herder.idle();
    off.herder.ownerMessage("乙");
    await off.herder.idle();
    expect(off.shown).toEqual([]);
    expect(off.faux.getPendingResponseCount()).toBe(0);
  });

  it("drops a suggestion the owner's next message overtook", async () => {
    const { herder, rec, faux, shown } = setup();
    faux.setResponses([fauxAssistantMessage("在的。")]);
    herder.ownerMessage("在吗");
    await herder.idle();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    faux.setResponses([
      fauxAssistantMessage("找到了。"),
      async () => {
        await gate;
        return fauxAssistantMessage("把 b 下载下来");
      },
      fauxAssistantMessage("好的。"),
    ]);
    herder.ownerMessage("搜一下");
    // Let the turn finish and the hidden request start, then the owner speaks first.
    for (let i = 0; i < 50 && faux.getPendingResponseCount() > 1; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    herder.ownerMessage("算了");
    release();
    await herder.idle();
    expect(shown).toEqual([]);
    expect(rec.audits.some((a) => a.type === "herder.suggestion" && a.data.stale === true)).toBe(
      true,
    );
  });
});
