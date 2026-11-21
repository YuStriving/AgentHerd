// Reading a plugin (ADR 0094): where it comes from (the official Claude Code plugin library or a
// GitHub link) and what is in its folder. AgentHerd takes two parts of a plugin: its MCP servers
// (tools for task agents, maybe for the Herder) and its skills (SKILL.md files agents read).
// Commands, sub-agents, hooks and the rest only work inside Claude Code or Gemini CLI; they are
// listed as left out. Nothing here touches the network.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

/** Where a plugin's files come from: a folder in a GitHub repository at a commit or branch. */
export interface GithubSource {
  owner: string;
  repo: string;
  /** A branch, tag or commit; the default branch when missing. */
  ref?: string;
  /** The plugin's folder inside the repository; the root when missing. */
  path?: string;
}

/** The official Claude Code plugin library (Anthropic). */
export const OFFICIAL_MARKETPLACE: GithubSource = {
  owner: "anthropics",
  repo: "claude-plugins-official",
  ref: "main",
};
export const OFFICIAL_PREFIX = "official:";

const SAFE_PART = /^[A-Za-z0-9._-]+$/;
const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

function cleanPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".." || !SAFE_PART.test(p))) {
    throw new Error(`the folder ${path} is not a plain folder in the repository`);
  }
  return parts.length === 0 ? undefined : parts.join("/");
}

function githubSource(owner: string, repo: string, ref?: string, path?: string): GithubSource {
  const name = repo.replace(/\.git$/, "");
  if (!SAFE_PART.test(owner) || !SAFE_PART.test(name)) {
    throw new Error(`${owner}/${repo} is not a GitHub repository name`);
  }
  if (ref !== undefined && (!SAFE_REF.test(ref) || ref.includes(".."))) {
    throw new Error(`${ref} is not a branch, tag or commit`);
  }
  const folder = cleanPath(path);
  return {
    owner,
    repo: name,
    ...(ref === undefined || ref === "" ? {} : { ref }),
    ...(folder === undefined ? {} : { path: folder }),
  };
}

/**
 * A GitHub link the owner pasted: `https://github.com/o/r`, `…/tree/<branch>/<folder>`,
 * `github.com/o/r`, `o/r`, or `o/r/folder@ref`. Throws a plain reason for anything else.
 */
export function parseGithubLink(text: string): GithubSource {
  const link = text.trim().replace(/\/+$/, "");
  const url = link.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(.*)$/i);
  if (url !== null) {
    const [, owner = "", repo = "", rest = ""] = url;
    const tree = rest.match(/^\/(?:tree|blob)\/([^/]+)(?:\/(.*))?$/);
    if (tree !== null) return githubSource(owner, repo, tree[1], tree[2]);
    if (rest === "" || rest === ".git") return githubSource(owner, repo);
    throw new Error("请贴仓库或文件夹的链接，比如 https://github.com/owner/repo");
  }
  const short = link.match(
    /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)((?:\/[A-Za-z0-9._-]+)*)(?:@(\S+))?$/,
  );
  if (short !== null) {
    const [, owner = "", repo = "", path = "", ref] = short;
    return githubSource(owner, repo, ref, path === "" ? undefined : path);
  }
  throw new Error("这不是 GitHub 链接：请贴 https://github.com/owner/repo 这样的地址");
}

/** The link shown to the owner for a source. */
export function githubUrl(s: GithubSource): string {
  const base = `https://github.com/${s.owner}/${s.repo}`;
  if (s.path === undefined && s.ref === undefined) return base;
  return `${base}/tree/${s.ref ?? "HEAD"}${s.path === undefined ? "" : `/${s.path}`}`;
}

/** The source string kept in config: `github:owner/repo[/folder][@ref]`. */
export function sourceKey(s: GithubSource): string {
  return `github:${s.owner}/${s.repo}${s.path === undefined ? "" : `/${s.path}`}${
    s.ref === undefined ? "" : `@${s.ref}`
  }`;
}

/** One entry of the official library, as its marketplace.json lists it. */
export interface MarketplaceEntry {
  name: string;
  displayName?: string;
  description?: string;
  category?: string;
  author?: { name?: string };
  homepage?: string;
  source: unknown;
}

/** Where an official entry's files are, or why AgentHerd cannot install it. */
export function entrySource(entry: MarketplaceEntry): GithubSource | { why: string } {
  const s = entry.source;
  if (typeof s === "string") {
    return githubSource(
      OFFICIAL_MARKETPLACE.owner,
      OFFICIAL_MARKETPLACE.repo,
      OFFICIAL_MARKETPLACE.ref,
      s,
    );
  }
  if (s === null || typeof s !== "object") return { why: "看不懂它的来源" };
  const o = s as { source?: string; url?: string; path?: string; ref?: string; sha?: string };
  if (o.source === "url" || o.source === "git-subdir" || o.source === "github") {
    const repoUrl =
      o.source === "github" && typeof (s as { repo?: string }).repo === "string"
        ? `github.com/${(s as { repo: string }).repo}`
        : (o.url ?? "");
    const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (m === null) return { why: "不在 GitHub 上" };
    try {
      return githubSource(m[1] as string, m[2] as string, o.sha ?? o.ref, o.path);
    } catch (error) {
      return { why: (error as Error).message };
    }
  }
  if (o.source === "command") return { why: "要用它自己的命令装，AgentHerd 不支持" };
  return { why: "看不懂它的来源" };
}

/** An MCP server of a plugin, with `${…}` still in place. */
export type PluginServerSpec =
  | {
      name: string;
      kind: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
    }
  | { name: string; kind: "http"; url: string; headers: Record<string, string> };

export interface PluginSkillSpec {
  name: string;
  description: string;
  /** The SKILL.md (or Gemini context file), relative to the plugin folder. */
  file: string;
}

export type PluginFormat = "claude" | "gemini";

/** What a plugin folder holds, as far as AgentHerd uses it. */
export interface PluginManifest {
  name: string;
  description: string;
  version?: string;
  author?: string;
  homepage?: string;
  format: PluginFormat;
  servers: PluginServerSpec[];
  skills: PluginSkillSpec[];
  /** Keys the servers read (`${GITHUB_TOKEN}`): the owner fills them in. */
  keys: string[];
  /** Parts that only work in Claude Code or Gemini CLI, in words: 「3 个斜杠命令」. */
  ignored: string[];
  /** Servers that cannot run here, in words. */
  problems: string[];
}

/** Variables the plugin folder stands for; never asked of the owner. */
const ROOT_VARS = new Set([
  "CLAUDE_PLUGIN_ROOT",
  "extensionPath",
  "workspacePath",
  "/",
  "pathSeparator",
]);
const VAR = /\$\{([A-Za-z_/][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${basename(path)} 不是合法的 JSON：${(error as Error).message}`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function stringMap(v: unknown): Record<string, string> {
  if (!isObject(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
}

/** A path inside the plugin folder, or undefined when it points outside. */
function inside(root: string, path: string): string | undefined {
  const full = resolve(root, path.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, "."));
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)) return undefined;
  return full;
}

/** One server entry of .mcp.json / plugin.json / gemini-extension.json. */
function serverOf(name: string, raw: unknown, problems: string[]): PluginServerSpec | undefined {
  if (!isObject(raw)) return undefined;
  const type = typeof raw.type === "string" ? raw.type : undefined;
  const url =
    typeof raw.httpUrl === "string"
      ? raw.httpUrl
      : typeof raw.url === "string"
        ? raw.url
        : undefined;
  if (typeof raw.command === "string" && raw.command !== "") {
    return {
      name,
      kind: "stdio",
      command: raw.command,
      args: strings(raw.args),
      env: stringMap(raw.env),
      ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
    };
  }
  if (url !== undefined) {
    if (
      type === "sse" ||
      (typeof raw.httpUrl !== "string" &&
        typeof raw.url === "string" &&
        type === undefined &&
        /\/sse\/?$/.test(url))
    ) {
      problems.push(`${name}：用的是旧的 SSE 连接方式，AgentHerd 不支持`);
      return undefined;
    }
    return { name, kind: "http", url, headers: stringMap(raw.headers) };
  }
  problems.push(`${name}：没写怎么启动`);
  return undefined;
}

function serversOf(raw: unknown, problems: string[]): PluginServerSpec[] {
  if (!isObject(raw)) return [];
  const map = isObject(raw.mcpServers) ? raw.mcpServers : raw;
  const out: PluginServerSpec[] = [];
  for (const [name, server] of Object.entries(map)) {
    const s = serverOf(name, server, problems);
    if (s !== undefined) out.push(s);
  }
  return out;
}

/** `name` and `description` from a SKILL.md's front matter (simple YAML only). */
export function skillFrontMatter(text: string): { name?: string; description?: string } {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (m === null) return {};
  const lines = (m[1] as string).split(/\r?\n/);
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = (lines[i] as string).match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv === null) continue;
    const key = kv[1] as string;
    let value = (kv[2] as string).trim();
    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] as string)) {
        block.push((lines[++i] as string).trim());
      }
      value = block.join(value.startsWith("|") ? "\n" : " ");
    }
    out[key] = value.replace(/^(["'])([\s\S]*)\1$/, "$2");
  }
  return {
    ...(out.name === undefined ? {} : { name: out.name }),
    ...(out.description === undefined ? {} : { description: out.description }),
  };
}

function skillsIn(root: string, dir: string): PluginSkillSpec[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: PluginSkillSpec[] = [];
  const own = join(dir, "SKILL.md");
  if (existsSync(own)) {
    const fm = skillFrontMatter(readFileSync(own, "utf8"));
    out.push({
      name: fm.name ?? basename(dir),
      description: fm.description ?? "",
      file: relative(root, own).split(sep).join("/"),
    });
    return out;
  }
  for (const entry of readdirSync(dir).sort()) {
    const file = join(dir, entry, "SKILL.md");
    if (!existsSync(file)) continue;
    const fm = skillFrontMatter(readFileSync(file, "utf8"));
    out.push({
      name: fm.name ?? entry,
      description: fm.description ?? "",
      file: relative(root, file).split(sep).join("/"),
    });
  }
  return out;
}

function countFiles(dir: string, ext: RegExp): number {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countFiles(p, ext);
    else if (ext.test(entry)) n += 1;
  }
  return n;
}

/** The `${…}` keys a server reads, without the plugin-folder variables. */
export function serverKeys(server: PluginServerSpec): string[] {
  const texts =
    server.kind === "stdio"
      ? [server.command, ...server.args, ...Object.values(server.env)]
      : [server.url, ...Object.values(server.headers)];
  const keys = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(VAR)) {
      const name = m[1] as string;
      if (!ROOT_VARS.has(name) && m[2] === undefined) keys.add(name);
    }
  }
  return [...keys];
}

/** Fills in `${…}`: the plugin folder, the owner's keys, then the process's environment. */
export function fillVars(
  text: string,
  root: string,
  keys: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>> = {},
): string {
  return text.replace(VAR, (_, name: string, fallback: string | undefined) => {
    if (name === "CLAUDE_PLUGIN_ROOT" || name === "extensionPath") return root;
    if (name === "/" || name === "pathSeparator") return sep;
    const v = keys[name] ?? env[name];
    return v !== undefined && v !== "" ? v : (fallback ?? "");
  });
}

/** Reads a plugin folder; throws a plain reason when it is not a plugin AgentHerd can use. */
export function readPlugin(root: string, fallbackName: string): PluginManifest {
  const problems: string[] = [];
  const ignored: string[] = [];
  const gemini = join(root, "gemini-extension.json");
  const claude = join(root, ".claude-plugin", "plugin.json");
  if (existsSync(gemini) && !existsSync(claude)) {
    const raw = readJson(gemini);
    if (!isObject(raw)) throw new Error("gemini-extension.json 不是一个对象");
    const servers = serversOf({ mcpServers: raw.mcpServers }, problems);
    const contextName = typeof raw.contextFileName === "string" ? raw.contextFileName : "GEMINI.md";
    const context = inside(root, contextName);
    const name = typeof raw.name === "string" ? raw.name : fallbackName;
    const skills: PluginSkillSpec[] = [
      ...(context !== undefined && existsSync(context)
        ? [
            {
              name,
              description:
                typeof raw.description === "string" ? raw.description : `${name} 的使用说明`,
              file: relative(root, context).split(sep).join("/"),
            },
          ]
        : []),
      ...skillsIn(root, join(root, "skills")),
    ];
    const commands = countFiles(join(root, "commands"), /\.toml$/);
    if (commands > 0) ignored.push(`${commands} 个斜杠命令`);
    if (isObject(raw.settings) || Array.isArray(raw.settings)) ignored.push("Gemini CLI 的设置项");
    return finish({
      name,
      description: typeof raw.description === "string" ? raw.description : "",
      ...(typeof raw.version === "string" ? { version: raw.version } : {}),
      format: "gemini",
      servers,
      skills,
      keys: [],
      ignored,
      problems,
    });
  }
  const manifest = existsSync(claude) ? readJson(claude) : {};
  if (!isObject(manifest)) throw new Error("plugin.json 不是一个对象");
  const servers: PluginServerSpec[] = [];
  const mcp = manifest.mcpServers;
  const mcpFiles = typeof mcp === "string" ? [mcp] : strings(mcp);
  if (isObject(mcp)) servers.push(...serversOf(mcp, problems));
  for (const f of mcpFiles) {
    const p = inside(root, f);
    if (p !== undefined && existsSync(p)) servers.push(...serversOf(readJson(p), problems));
  }
  const dotMcp = join(root, ".mcp.json");
  if (mcp === undefined && existsSync(dotMcp))
    servers.push(...serversOf(readJson(dotMcp), problems));
  const skillDirs = [
    ...(typeof manifest.skills === "string" ? [manifest.skills] : strings(manifest.skills)),
  ];
  const skills =
    skillDirs.length > 0
      ? skillDirs.flatMap((d) => {
          const p = inside(root, d);
          return p === undefined ? [] : skillsIn(root, p);
        })
      : [
          ...skillsIn(root, join(root, "skills")),
          ...(existsSync(join(root, "SKILL.md")) ? skillsIn(root, root) : []),
        ];
  const commands = countFiles(join(root, "commands"), /\.md$/);
  if (commands > 0) ignored.push(`${commands} 个斜杠命令`);
  const agents = countFiles(join(root, "agents"), /\.md$/);
  if (agents > 0) ignored.push(`${agents} 个子 Agent`);
  if (manifest.hooks !== undefined || existsSync(join(root, "hooks", "hooks.json")))
    ignored.push("钩子");
  if (manifest.lspServers !== undefined || existsSync(join(root, ".lsp.json")))
    ignored.push("语言服务");
  if (manifest.outputStyles !== undefined || existsSync(join(root, "output-styles")))
    ignored.push("输出风格");
  if (!existsSync(claude) && servers.length === 0 && skills.length === 0) {
    throw new Error(
      "这里没有 AgentHerd 能用的东西：没找到 .claude-plugin/plugin.json、gemini-extension.json、.mcp.json 或 skills/",
    );
  }
  const author =
    isObject(manifest.author) && typeof manifest.author.name === "string"
      ? manifest.author.name
      : undefined;
  return finish({
    name: typeof manifest.name === "string" ? manifest.name : fallbackName,
    description: typeof manifest.description === "string" ? manifest.description : "",
    ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
    ...(author === undefined ? {} : { author }),
    ...(typeof manifest.homepage === "string" ? { homepage: manifest.homepage } : {}),
    format: "claude",
    servers,
    skills,
    keys: [],
    ignored,
    problems,
  });
}

function finish(m: PluginManifest): PluginManifest {
  const keys = new Set<string>();
  for (const s of m.servers) for (const k of serverKeys(s)) keys.add(k);
  if (m.servers.length === 0 && m.skills.length === 0) {
    throw new Error(
      m.ignored.length > 0
        ? `这个插件只有 ${m.ignored.join("、")}，只能在 Claude Code 或 Gemini CLI 里用，AgentHerd 用不上`
        : "这个插件里没有工具（MCP 服务）也没有技能，AgentHerd 用不上",
    );
  }
  return { ...m, keys: [...keys] };
}
