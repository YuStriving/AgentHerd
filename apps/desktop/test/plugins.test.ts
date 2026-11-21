import type { PluginCatalogEntry, PluginView } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";
import {
  catalogCategories,
  filterCatalog,
  pluginBadge,
  pluginLine,
} from "../src/renderer/src/plugins";

const base: PluginView = {
  id: "notes",
  source: "github:o/notes",
  link: "https://github.com/o/notes",
  name: "notes",
  description: "Takes notes",
  format: "claude",
  servers: [{ name: "notes", kind: "stdio", run: "node server.js" }],
  keys: [],
  skills: [{ name: "summarize", description: "" }],
  ignored: [],
  problems: [],
  enabled: true,
  herder: false,
  installedAt: "2026-11-21T00:00:00.000Z",
  state: "ready",
  tools: 3,
  readTools: 1,
  keysSet: [],
  dir: "/p",
};

describe("the 插件 section (ADR 0094)", () => {
  it("says what state a plugin is in", () => {
    expect(pluginBadge(base)).toEqual({ label: "能用", tone: "green" });
    expect(pluginBadge({ ...base, enabled: false })).toEqual({ label: "关着", tone: "gray" });
    expect(pluginBadge({ ...base, keys: ["T"] })).toEqual({ label: "缺 Key", tone: "amber" });
    expect(pluginBadge({ ...base, keys: ["T"], keysSet: ["T"], state: "failed" })).toEqual({
      label: "出错",
      tone: "red",
    });
    expect(pluginBadge({ ...base, state: "idle" }).label).toBe("用到时启动");
    expect(pluginLine(base)).toBe("3 个工具（1 个只读） · 1 个技能 · Takes notes");
    expect(pluginLine({ ...base, state: "idle" })).toBe("1 个工具服务 · 1 个技能 · Takes notes");
    expect(pluginLine({ ...base, state: "failed", problem: "notes：exited" })).toBe(
      "notes：exited",
    );
  });

  it("filters the library by words and category, installable ones first", () => {
    const entries: PluginCatalogEntry[] = [
      {
        name: "xcode",
        title: "Xcode",
        description: "iOS docs",
        category: "development",
        why: "x",
        installed: false,
      },
      {
        name: "context7",
        title: "Context7",
        description: "Up-to-date docs",
        category: "development",
        source: "official:context7",
        installed: false,
      },
      {
        name: "github",
        title: "GitHub",
        description: "Issues and PRs",
        category: "productivity",
        source: "official:github",
        installed: true,
      },
    ];
    expect(filterCatalog(entries, "docs").map((e) => e.name)).toEqual(["context7", "xcode"]);
    expect(filterCatalog(entries, "", "productivity").map((e) => e.name)).toEqual(["github"]);
    expect(filterCatalog(entries, "DOCS up").map((e) => e.name)).toEqual(["context7"]);
    expect(catalogCategories(entries)).toEqual(["development", "productivity"]);
  });
});
