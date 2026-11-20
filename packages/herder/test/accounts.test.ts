import {
  fauxAssistantMessage,
  registerFauxProvider,
  streamSimple,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { Herder } from "../src/herder.ts";
import { accountsPrompt, systemPrompt } from "../src/prompt.ts";
import { fakeHost } from "./helpers.ts";

const faux: { unregister(): void }[] = [];
afterEach(() => {
  for (const f of faux.splice(0)) f.unregister();
});

describe("connected accounts in the system prompt (ADR 0089)", () => {
  it("lists what is signed in, or says nothing is connected and where to connect it", () => {
    expect(
      accountsPrompt({
        socials: [
          { name: "小红书", ready: true },
          { name: "知乎", ready: false },
        ],
        apps: ["gmail"],
      }),
    ).toBe(
      "Connected accounts (kept up to date; session_list shows the same):\n- 小红书: signed in\n- 知乎: turned on, not signed in\n- Apps: gmail",
    );
    expect(accountsPrompt({ socials: [], apps: [] })).toContain("- None.");
    expect(systemPrompt("zh-CN")).toContain("A 小红书 or 知乎 link from the owner");
    expect(systemPrompt("zh-CN")).toContain(
      "never\n  say you cannot open it or ask for a screenshot",
    );
  });

  it("the Herder sees it from the first turn and again right after a connection changes", async () => {
    const registration = registerFauxProvider();
    faux.push(registration);
    const { host } = fakeHost();
    let ready = false;
    host.socialWatches = () => [
      {
        platform: "xiaohongshu",
        name: "小红书",
        ready,
        watch: { mentions: true, likes: false, follows: false },
      },
    ];
    const systems: string[] = [];
    const reply = (text: string) => (context: { systemPrompt?: unknown; messages: unknown[] }) => {
      systems.push(JSON.stringify(context.systemPrompt ?? context.messages[0]));
      return fauxAssistantMessage(text);
    };
    registration.setResponses([reply("好"), reply("好")]);
    const herder = new Herder({
      host,
      model: registration.getModel(),
      streamFn: streamSimple,
      sleep: async () => {},
    });
    herder.ownerMessage("在吗");
    await herder.idle();
    ready = true;
    herder.ownerMessage("现在呢");
    await herder.idle();
    expect(systems[0]).toContain("- 小红书: turned on, not signed in");
    expect(systems[1]).toContain("- 小红书: signed in");
    expect(systems[1]).not.toContain("turned on, not signed in");
    await herder.stop();
  });
});
