# 0094. Plugins from the Claude Code library or a GitHub link

- Status: Accepted
- Date: 2026-11-21
- Changes: [0041](0041-agent-tools-through-a-local-mcp-gateway.md) (the gateway also carries plugin tools)

## Context

The owner asked for plugin install (「插件安装吧」) after we looked at how Qwen Code installs
Claude Code plugins and Gemini CLI extensions. There are hundreds of them: the official
Claude Code library ([anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official))
alone lists 317. Most of what they carry is for Claude Code itself (slash commands, sub-agents,
hooks, output styles), but two parts work for any agent: MCP servers (tools) and skills
(`SKILL.md` instructions). The owner also asked that each plugin have its own switch for the
Herder, off by default: 「主管也能用」.

## Decision

1. **Where plugins come from.** The 应用连接 page gets a 「插件」 section with 「插件库」 (the
   official library's `marketplace.json`, cached 6 hours, searchable by words and category) and
   「从链接装」 (a GitHub repository or folder link: `https://github.com/o/r`, `…/tree/<ref>/<folder>`,
   or `o/r/folder@ref`). Only public GitHub sources: the library's `url`, `git-subdir`, `github` and
   local entries resolve to GitHub; `command` entries (they install with their own tool) are listed
   with the reason they cannot be installed.
2. **Two formats.** A Claude Code plugin (`.claude-plugin/plugin.json`, `mcpServers` in it or in
   `.mcp.json`, `skills/*/SKILL.md`) and a Gemini CLI extension (`gemini-extension.json` with
   `mcpServers`, its `contextFileName` kept as a skill, `skills/`). Stdio and Streamable HTTP
   servers are used; SSE servers, commands, sub-agents, hooks, LSP servers and output styles are
   listed as 「AgentHerd 用不上的部分」. A plugin with no server and no skill is refused with that
   reason.
3. **Look before keeping.** 「看看」 downloads the folder (codeload tarball, at most 100 MB) into
   `plugins/.staging/` and shows: what each server runs (the command line, or the address), the
   skills, the keys its config needs (`${VAR}` without a default) and what is left out, with a
   warning that third-party code runs on this computer. Nothing is kept until 「安装」; a staged copy
   is removed after 30 minutes.
4. **Installed.** The folder moves to `~/.agentherd/plugins/<id>`, `config.json` gets
   `plugins: [{id, source, name, enabled, herder, installedAt}]`, keys go to the secret store as
   `plugin:<id>:<KEY>`. `${CLAUDE_PLUGIN_ROOT}` / `${extensionPath}` become the folder, keys and
   the environment fill the rest. Servers start when an agent first needs them (or right after
   install, to show whether they work) and stop when the plugin is turned off, changed or removed.
5. **Tasks.** Every plugin that is on adds its tools to the agentherd gateway as `<ID>__<tool>`.
   Tools the server marks `readOnlyHint` run directly; every other tool counts as one that may
   change something outside, so the gateway asks the owner first (ADR 0041's app-call approval).
   Every new task is told the skills, with the path of each `SKILL.md`, and reads one when its work
   matches.
6. **The Herder.** Off by default per plugin. Turned on, the Herder's system prompt lists that
   plugin's read-only tools and skills under Connected accounts, and it gets two tools:
   `plugin_call` (read-only tools only; replies cut at 20,000 characters) and `plugin_skill`.
   Changing tools stay with tasks.
7. **Each row** shows a state (能用 / 启动中 / 出错 / 缺 Key / 关着 / 用到时启动), the tool and skill
   counts, a main switch, the commands it runs, keys to fill or replace, the 「主管也能用」 switch
   and 删除插件 (folder and keys removed).

## Alternatives

- **Install everything a plugin has** (commands, sub-agents, hooks) into each agent's own config:
  only Claude Code reads those, and hooks run code on every step without asking.
- **npm and other git hosts:** fewer plugins live there; GitHub covers the official library.
- **OAuth for remote servers:** servers that need a sign-in say so (「OAuth 现在还不支持」); later.
- **Let the Herder use every tool:** the Herder has no approval step of its own, so changing tools
  stay with tasks where the gateway asks.

## Consequences

- Plugins run third-party code with the owner's rights; the consent dialog shows the exact command
  first, and the source link is one click away.
- A server that needs Node or Python needs them on PATH (AgentHerd adds its own tool folder).
- The Herder's prompt grows by one line per tool or skill it may use, only when the owner allows it.

## Tests

`packages/host/test/plugins.test.ts` (links, library entries, both formats, `${…}` filling,
look/install/keys/off/remove with a fake download and server, gateway hints, Herder limits),
`packages/herder/test/plugin-tools.test.ts`, `apps/desktop/test/plugins.test.ts`.
