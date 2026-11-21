// The Herder's plugin tools and the plugin lines in its prompt (ADR 0094).

import type { HerderHost } from "@agentherd/core";
import { describe, expect, it } from "vitest";
import { pluginReplyText, pluginTools } from "../src/plugin-tools.ts";
import { accountsPrompt } from "../src/prompt.ts";

type Tool = {
  name: string;
  execute(id: string, args: unknown): Promise<{ content: { text: string }[] }>;
};

describe("plugins for the Herder (ADR 0094)", () => {
  it("has no plugin tools without plugins, and two with them", async () => {
    expect(pluginTools({} as HerderHost)).toEqual([]);
    const calls: unknown[] = [];
    const host = {
      plugins: {
        list: () => ({ tools: [], skills: [] }),
        call: async (name: string, args: unknown) => {
          calls.push([name, args]);
          return { content: [{ type: "text", text: "docs for react" }] };
        },
        skill: (name: string) => `# ${name}`,
      },
    } as unknown as HerderHost;
    const [call, skill] = pluginTools(host) as unknown as Tool[];
    expect(call?.name).toBe("plugin_call");
    expect(
      (await call?.execute("1", { name: "C7__docs", args: { q: "react" } }))?.content[0]?.text,
    ).toBe("docs for react");
    expect(calls).toEqual([["C7__docs", { q: "react" }]]);
    expect((await skill?.execute("2", { name: "review" }))?.content[0]?.text).toBe("# review");
  });

  it("reads MCP replies as text, cut and marked when they failed", () => {
    expect(
      pluginReplyText({
        content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }],
      }),
    ).toBe("a\nb");
    expect(pluginReplyText({ ok: 1 })).toBe('{"ok":1}');
    expect(pluginReplyText({ content: [{ type: "text", text: "no" }], isError: true })).toBe(
      "The plugin said this failed:\nno",
    );
    expect(pluginReplyText({ content: [{ type: "text", text: "x".repeat(20_010) }] })).toMatch(
      /10 more characters left out\)$/,
    );
  });

  it("lists the plugin tools and skills under the connected accounts", () => {
    const text = accountsPrompt({
      socials: [],
      apps: [],
      plugins: {
        tools: [{ name: "CONTEXT7__get-library-docs", description: "Fetches   up-to-date docs" }],
        skills: [{ name: "code-review", description: "" }],
      },
    });
    expect(text).toContain("Plugins the owner let you use (ADR 0094)");
    expect(text).toContain("- tool CONTEXT7__get-library-docs: Fetches up-to-date docs");
    expect(text).toContain("- skill code-review");
    expect(
      accountsPrompt({ socials: [], apps: [], plugins: { tools: [], skills: [] } }),
    ).not.toContain("Plugins");
  });
});
