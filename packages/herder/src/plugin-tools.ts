// The Herder's two plugin tools (ADR 0094): call a read-only tool of a plugin the owner let it
// use, and read one of those plugins' skills. Plugin tools that change things are only for tasks,
// where the gateway asks the owner first.

import type { HerderHost } from "@agentherd/core";
import type { AgentTool, AgentToolResult } from "@agentherd/herder-loop";
import { obj, opt, str, unknown } from "@earendil-works/pi-schema";

/** Plugin replies longer than this are cut for the Herder. */
export const PLUGIN_REPLY_MAX = 20_000;

export const PLUGIN_TOOL_NAMES: ReadonlySet<string> = new Set(["plugin_call", "plugin_skill"]);

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

/** An MCP tool result as plain text: its text parts, else the JSON. */
export function pluginReplyText(result: unknown): string {
  const r = result as { content?: { type?: string; text?: string }[]; isError?: boolean };
  const parts = Array.isArray(r?.content)
    ? r.content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text)
    : [];
  const text = parts.length > 0 ? parts.join("\n") : JSON.stringify(result ?? null);
  const cut =
    text.length > PLUGIN_REPLY_MAX
      ? `${text.slice(0, PLUGIN_REPLY_MAX)}\n… (${text.length - PLUGIN_REPLY_MAX} more characters left out)`
      : text;
  return r?.isError === true ? `The plugin said this failed:\n${cut}` : cut;
}

const callSchema = obj({
  name: str({ description: "the tool's name as listed under Plugins in Connected accounts" }),
  args: opt(unknown({ description: "the tool's arguments, an object that fits its input" })),
});

const skillSchema = obj({
  name: str({ description: "the skill's name as listed under Plugins in Connected accounts" }),
});

/** Present only when the host has plugins (the list may still be empty). */
export function pluginTools(host: HerderHost): AgentTool[] {
  const plugins = host.plugins;
  if (plugins === undefined) return [];
  const call = {
    name: "plugin_call",
    label: "Use a plugin tool",
    description:
      "Calls one read-only tool of a plugin the owner let you use (listed under Plugins in Connected accounts). Tools that change things are for tasks only.",
    parameters: callSchema,
    execute: async (_id: string, args: { name: string; args?: unknown }) =>
      ok(pluginReplyText(await plugins.call(args.name, args.args ?? {}))),
  };
  const skill = {
    name: "plugin_skill",
    label: "Read a plugin skill",
    description:
      "Reads the instructions of a skill from a plugin the owner let you use. Read it before doing the kind of work it is for; a task with the same work is told about the skill by itself.",
    parameters: skillSchema,
    execute: async (_id: string, args: { name: string }) => ok(plugins.skill(args.name)),
  };
  return [call, skill] as unknown as AgentTool[];
}
