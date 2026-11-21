// What the 插件 section shows (ADR 0094): a plugin's state as a word and a color, and the
// official library filtered by what the owner types.

import type { PluginCatalogEntry, PluginView } from "@agentherd/host/api";

export type PluginTone = "gray" | "blue" | "green" | "amber" | "red";

/** The badge next to an installed plugin. */
export function pluginBadge(p: PluginView): { label: string; tone: PluginTone } {
  if (!p.enabled) return { label: "关着", tone: "gray" };
  const missing = p.keys.filter((k) => !p.keysSet.includes(k));
  if (missing.length > 0) return { label: "缺 Key", tone: "amber" };
  switch (p.state) {
    case "ready":
      return { label: "能用", tone: "green" };
    case "starting":
      return { label: "启动中", tone: "blue" };
    case "failed":
      return { label: "出错", tone: "red" };
    default:
      return { label: "用到时启动", tone: "gray" };
  }
}

/** One line under the name: the problem when there is one, else what it gives agents. */
export function pluginLine(p: PluginView): string {
  if (p.problem !== undefined && p.enabled) return p.problem;
  const parts: string[] = [];
  if (p.state === "ready" && p.servers.length > 0) {
    parts.push(
      `${p.tools} 个工具${p.readTools > 0 && p.readTools < p.tools ? `（${p.readTools} 个只读）` : ""}`,
    );
  } else if (p.servers.length > 0) {
    parts.push(`${p.servers.length} 个工具服务`);
  }
  if (p.skills.length > 0) parts.push(`${p.skills.length} 个技能`);
  const what = parts.join(" · ");
  return what === "" ? p.description : p.description === "" ? what : `${what} · ${p.description}`;
}

/** The library's categories, most plugins first. */
export function catalogCategories(entries: readonly PluginCatalogEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.category !== undefined) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c);
}

/**
 * Entries matching every word typed (name, title, description, category, author), in one
 * category or all; ones AgentHerd can install come first, then by name.
 */
export function filterCatalog(
  entries: readonly PluginCatalogEntry[],
  query: string,
  category?: string,
): PluginCatalogEntry[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "");
  return entries
    .filter((e) => category === undefined || e.category === category)
    .filter((e) => {
      const text = [e.name, e.title, e.description, e.category ?? "", e.author ?? ""]
        .join(" ")
        .toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort(
      (a, b) =>
        Number(a.source === undefined) - Number(b.source === undefined) ||
        a.title.localeCompare(b.title),
    );
}
