/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${…} is the plugin variable syntax under test */
// Plugins (ADR 0094): reading a plugin folder, links, the official library, and installing one
// with a fake download and a fake MCP server.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import type { SecretStore } from "@agentherd/core";
import { afterEach, describe, expect, it } from "vitest";
import type { CliConfig } from "../src/config.ts";
import {
  entrySource,
  fillVars,
  githubUrl,
  parseGithubLink,
  readPlugin,
  skillFrontMatter,
  sourceKey,
} from "../src/plugin-manifest.ts";
import type { McpClient, PluginTool } from "../src/plugin-mcp.ts";
import { PluginStore, pluginToolName, type RunningServer } from "../src/plugins.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "ah-plugins-"));
  dirs.push(d);
  return d;
}

function write(root: string, file: string, text: string): void {
  const path = join(root, ...file.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** A Claude Code plugin with a stdio server needing a key, a skill, commands and an SSE server. */
function claudePlugin(root: string): void {
  write(
    root,
    ".claude-plugin/plugin.json",
    JSON.stringify({
      name: "notes",
      description: "Takes notes",
      version: "1.2.0",
      author: { name: "Ann" },
    }),
  );
  write(
    root,
    ".mcp.json",
    JSON.stringify({
      mcpServers: {
        notes: {
          command: "node",
          args: ["${CLAUDE_PLUGIN_ROOT}/server.js"],
          env: { NOTES_TOKEN: "${NOTES_TOKEN}", MODE: "${MODE:-fast}" },
        },
        old: { type: "sse", url: "https://example.com/sse" },
      },
    }),
  );
  write(
    root,
    "skills/summarize/SKILL.md",
    "---\nname: summarize\ndescription: Summarize a long note\n---\n\nSteps…",
  );
  write(root, "commands/a.md", "x");
  write(root, "commands/b.md", "x");
  write(root, "agents/helper.md", "x");
}

describe("plugin links (ADR 0094)", () => {
  it("reads the links people paste", () => {
    expect(parseGithubLink("https://github.com/upstash/context7")).toEqual({
      owner: "upstash",
      repo: "context7",
    });
    expect(parseGithubLink("github.com/a/b.git")).toEqual({ owner: "a", repo: "b" });
    const deep = parseGithubLink("https://github.com/o/r/tree/main/plugins/x/");
    expect(deep).toEqual({ owner: "o", repo: "r", ref: "main", path: "plugins/x" });
    expect(githubUrl(deep)).toBe("https://github.com/o/r/tree/main/plugins/x");
    expect(sourceKey(deep)).toBe("github:o/r/plugins/x@main");
    expect(parseGithubLink("o/r/plugins/x@v1")).toEqual({
      owner: "o",
      repo: "r",
      ref: "v1",
      path: "plugins/x",
    });
    expect(() => parseGithubLink("https://gitlab.com/o/r")).toThrow(/不是 GitHub 链接/);
    expect(() => parseGithubLink("https://github.com/o/r/issues/3")).toThrow(/仓库或文件夹/);
    expect(() => parseGithubLink("o/r/../etc")).toThrow();
  });

  it("finds where an official library entry lives, or says why not", () => {
    expect(entrySource({ name: "github", source: "./external_plugins/github" })).toEqual({
      owner: "anthropics",
      repo: "claude-plugins-official",
      ref: "main",
      path: "external_plugins/github",
    });
    expect(
      entrySource({
        name: "a",
        source: { source: "url", url: "https://github.com/x/y.git", sha: "abc123" },
      }),
    ).toEqual({ owner: "x", repo: "y", ref: "abc123" });
    expect(
      entrySource({
        name: "b",
        source: { source: "git-subdir", url: "https://github.com/x/y", path: "p/q", ref: "main" },
      }),
    ).toEqual({ owner: "x", repo: "y", ref: "main", path: "p/q" });
    expect(entrySource({ name: "c", source: { source: "command", command: "x" } })).toEqual({
      why: "要用它自己的命令装，AgentHerd 不支持",
    });
    expect(
      entrySource({ name: "d", source: { source: "url", url: "https://gitlab.com/x/y" } }),
    ).toEqual({
      why: "不在 GitHub 上",
    });
  });
});

describe("reading a plugin folder (ADR 0094)", () => {
  it("takes a Claude Code plugin's servers and skills and says what it leaves out", () => {
    const root = temp();
    claudePlugin(root);
    const m = readPlugin(root, "fallback");
    expect(m).toMatchObject({
      name: "notes",
      description: "Takes notes",
      version: "1.2.0",
      author: "Ann",
      format: "claude",
    });
    expect(m.servers).toEqual([
      {
        name: "notes",
        kind: "stdio",
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/server.js"],
        env: { NOTES_TOKEN: "${NOTES_TOKEN}", MODE: "${MODE:-fast}" },
      },
    ]);
    expect(m.keys).toEqual(["NOTES_TOKEN"]);
    expect(m.skills).toEqual([
      {
        name: "summarize",
        description: "Summarize a long note",
        file: "skills/summarize/SKILL.md",
      },
    ]);
    expect(m.ignored.join(" ")).toMatch(/2 个斜杠命令/);
    expect(m.ignored.join(" ")).toMatch(/1 个子 Agent/);
    expect(m.problems.join(" ")).toMatch(/SSE/);
  });

  it("takes a Gemini CLI extension, its context file as a skill", () => {
    const root = temp();
    write(
      root,
      "gemini-extension.json",
      JSON.stringify({
        name: "weather",
        version: "0.1.0",
        contextFileName: "GEMINI.md",
        mcpServers: {
          forecast: {
            httpUrl: "https://w.example.com/mcp",
            headers: { "X-Key": "${WEATHER_KEY}" },
          },
        },
      }),
    );
    write(root, "GEMINI.md", "Use forecast for weather questions.");
    const m = readPlugin(root, "weather");
    expect(m.format).toBe("gemini");
    expect(m.servers).toEqual([
      {
        name: "forecast",
        kind: "http",
        url: "https://w.example.com/mcp",
        headers: { "X-Key": "${WEATHER_KEY}" },
      },
    ]);
    expect(m.keys).toEqual(["WEATHER_KEY"]);
    expect(m.skills.map((s) => s.file)).toEqual(["GEMINI.md"]);
  });

  it("refuses a plugin AgentHerd cannot use", () => {
    const root = temp();
    write(root, ".claude-plugin/plugin.json", JSON.stringify({ name: "cmds" }));
    write(root, "commands/a.md", "x");
    expect(() => readPlugin(root, "cmds")).toThrow(/只能在 Claude Code 或 Gemini CLI 里用/);
  });

  it("fills ${…} from the plugin folder, keys and defaults", () => {
    expect(fillVars("${CLAUDE_PLUGIN_ROOT}/s.js", "/p", {}, {})).toBe("/p/s.js");
    expect(fillVars("Bearer ${T}", "/p", { T: "k" }, {})).toBe("Bearer k");
    expect(fillVars("${MODE:-fast}", "/p", {}, {})).toBe("fast");
    expect(fillVars("${HOME}", "/p", {}, { HOME: "/u" })).toBe("/u");
    expect(skillFrontMatter('---\nname: a\ndescription: "b c"\n---\nx')).toEqual({
      name: "a",
      description: "b c",
    });
  });
});

class MemorySecrets implements SecretStore {
  readonly map = new Map<string, string>();
  get(a: string): string | undefined {
    return this.map.get(a);
  }
  set(a: string, v: string): void {
    this.map.set(a, v);
  }
  delete(a: string): void {
    this.map.delete(a);
  }
}

const TOOLS: PluginTool[] = [
  {
    name: "find",
    description: "Finds notes",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  },
  { name: "write", description: "Writes a note", inputSchema: { type: "object" } },
];

function setup(catalog?: unknown) {
  const home = temp();
  const repo = temp();
  claudePlugin(join(repo, "notes-main", "plugins", "notes"));
  let config: CliConfig = {};
  const secrets = new MemorySecrets();
  const started: RunningServer[] = [];
  const calls: { name: string; args: unknown }[] = [];
  const fetched: string[] = [];
  let changes = 0;
  const store = new PluginStore({
    home,
    secrets,
    config: () => config,
    save: (change) => {
      config = change(config);
    },
    changed: () => {
      changes++;
    },
    env: () => ({ PATH: "/bin" }),
    fetchFn: (async (url: string) => {
      fetched.push(String(url));
      if (String(url).includes("marketplace.json")) return new Response(JSON.stringify(catalog));
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch,
    extract: async (_file, dir) => {
      cpSync(repo, dir, { recursive: true });
    },
    client: (server): McpClient => {
      started.push(server);
      return {
        tools: async () => TOOLS,
        call: async (name, args) => {
          calls.push({ name, args });
          return { content: [{ type: "text", text: `did ${name}` }] };
        },
        close: () => undefined,
      };
    },
  });
  return {
    home,
    store,
    secrets,
    started,
    calls,
    fetched,
    config: () => config,
    changes: () => changes,
  };
}

describe("installing a plugin (ADR 0094)", () => {
  it("shows what it would run before keeping anything, then installs it off for the Herder", async () => {
    const t = setup();
    const preview = await t.store.preview("https://github.com/o/notes/tree/main/plugins/notes");
    expect(t.fetched[0]).toBe("https://codeload.github.com/o/notes/tar.gz/main");
    expect(preview).toMatchObject({
      source: "github:o/notes/plugins/notes@main",
      link: "https://github.com/o/notes/tree/main/plugins/notes",
      name: "notes",
      keys: ["NOTES_TOKEN"],
      servers: [{ name: "notes", kind: "stdio", run: "node ${CLAUDE_PLUGIN_ROOT}/server.js" }],
      skills: [{ name: "summarize", description: "Summarize a long note" }],
    });
    expect(t.config().plugins).toBeUndefined();
    expect(existsSync(join(t.home, "plugins", "notes"))).toBe(false);

    const views = await t.store.install(preview.source, { NOTES_TOKEN: " k1 " });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      id: "notes",
      enabled: true,
      herder: false,
      keysSet: ["NOTES_TOKEN"],
    });
    expect(t.secrets.get("plugin:notes:NOTES_TOKEN")).toBe("k1");
    expect(existsSync(join(t.home, "plugins", "notes", ".mcp.json"))).toBe(true);
    expect(t.config().plugins?.[0]).toMatchObject({
      id: "notes",
      source: preview.source,
      herder: false,
    });
  });

  it("gives tasks its tools, asking before anything that is not read-only", async () => {
    const t = setup();
    await t.store.install("o/notes/plugins/notes@main", { NOTES_TOKEN: "k1" });
    const apps = t.store.tools();
    if (apps === undefined) throw new Error("no tools");
    const list = await apps.list();
    expect(list.map((x) => x.name)).toEqual(["NOTES__find", "NOTES__write"]);
    const server = t.started[0];
    expect(server).toMatchObject({ kind: "stdio", command: "node" });
    if (server?.kind !== "stdio") throw new Error("not stdio");
    expect(normalize(server.args[0] ?? "")).toBe(join(t.home, "plugins", "notes", "server.js"));
    expect(server.env.NOTES_TOKEN).toBe("k1");
    expect(server.env.MODE).toBe("fast");
    const info = await apps.describe(["NOTES__find", "NOTES__write"]);
    expect(info.get("NOTES__find")).toMatchObject({
      toolkit: "plugin:notes",
      hints: { readOnly: true, create: false },
    });
    expect(info.get("NOTES__write")).toMatchObject({ hints: { readOnly: false, create: true } });
    expect(await apps.call("NOTES__write", { text: "a" })).toEqual({
      content: [{ type: "text", text: "did write" }],
    });
    expect(t.calls).toEqual([{ name: "write", args: { text: "a" } }]);
    expect(t.store.note()).toContain(
      `summarize (notes): Summarize a long note — ${join(t.home, "plugins", "notes", "skills", "summarize", "SKILL.md")}`,
    );
    expect(t.store.views()[0]).toMatchObject({ state: "ready", tools: 2, readTools: 1 });
  });

  it("lets the Herder use only read-only tools and skills, and only when the owner turns it on", async () => {
    const t = setup();
    await t.store.install("o/notes/plugins/notes@main", {});
    expect(t.store.herderList()).toEqual({ tools: [], skills: [] });
    await expect(t.store.herderCall("NOTES__find", {})).rejects.toThrow(
      /not a read-only plugin tool/,
    );
    await t.store.set("notes", { herder: true });
    await t.store.herderTools();
    expect(t.store.herderList()).toEqual({
      tools: [{ name: "NOTES__find", description: "Finds notes" }],
      skills: [{ name: "summarize", description: "Summarize a long note" }],
    });
    expect(await t.store.herderCall("NOTES__find", { q: "x" })).toEqual({
      content: [{ type: "text", text: "did find" }],
    });
    await expect(t.store.herderCall("NOTES__write", {})).rejects.toThrow(
      /not a read-only plugin tool/,
    );
    expect(t.store.skillText("summarize")).toContain("Steps…");
  });

  it("turns off, changes keys and removes everything it kept", async () => {
    const t = setup();
    await t.store.install("o/notes/plugins/notes@main", { NOTES_TOKEN: "k1" });
    await t.store.set("notes", { enabled: false });
    expect(t.store.tools()).toBeUndefined();
    expect(t.store.note()).toBeUndefined();
    expect(t.store.views()[0]?.state).toBe("off");
    await t.store.set("notes", { enabled: true, keys: { NOTES_TOKEN: "k2" } });
    expect(t.secrets.get("plugin:notes:NOTES_TOKEN")).toBe("k2");
    await t.store.remove("notes");
    expect(t.config().plugins).toEqual([]);
    expect(t.secrets.get("plugin:notes:NOTES_TOKEN")).toBeUndefined();
    expect(existsSync(join(t.home, "plugins", "notes"))).toBe(false);
    await expect(t.store.remove("notes")).rejects.toThrow(/没有 notes 这个插件/);
  });

  it("lists the official library, with the ones it cannot install and why", async () => {
    const t = setup({
      plugins: [
        {
          name: "notes",
          description: "Takes notes",
          category: "productivity",
          source: "./plugins/notes",
        },
        { name: "xcode", description: "Xcode", source: { source: "command", command: "x" } },
      ],
    });
    const list = await t.store.catalog();
    expect(list).toEqual([
      {
        name: "notes",
        title: "notes",
        description: "Takes notes",
        category: "productivity",
        source: "official:notes",
        installed: false,
      },
      {
        name: "xcode",
        title: "xcode",
        description: "Xcode",
        why: "要用它自己的命令装，AgentHerd 不支持",
        installed: false,
      },
    ]);
    expect(
      JSON.parse(readFileSync(join(t.home, "plugins", "catalog.json"), "utf8")).plugins,
    ).toHaveLength(2);
  });

  it("names tools so agents can call them", () => {
    expect(pluginToolName("context7", "resolve-library-id")).toBe("CONTEXT7__resolve-library-id");
    expect(pluginToolName("my plugin", "a.b")).toBe("MY_PLUGIN__a_b");
    expect(pluginToolName("x", "y".repeat(80))).toHaveLength(64);
  });
});
