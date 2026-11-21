# 0093. The 主管 page shows what the Herder's context is made of

- Status: Accepted; what the tab shows and where it reads it changed by [0096](0096-the-context-tab-reads-herd-db-and-shows-the-folds-as-a-tree.md)
- Date: 2026-11-21
- Changes: [0045](0045-herder-context-folded-by-the-model.md) (the folds become visible), [0065](0065-one-herder-voice-and-a-trail-only-herder-page.md) (the 主管 page gets a second tab)

## Context

The Herder keeps its whole conversation and folds old parts itself (ADR 0045), but the owner
could not see any of it: how full the context was, what filled it, what was folded, or how many
tokens the Herder's model used. Looking at [dsh-context](https://github.com/bowenliang123/dsh-context),
a DeepSeek Harness plugin with a Context tab (current context as a stacked bar against the
window, a per-step trend with fold markers, a browser of everything in the context), the owner
asked: 「我们这个上下文能不能做成类似dsh-context那样好看的面板」.

AgentHerd did not record what each request cost. The provider's usage (input, output, cache read
and write) arrived on every assistant message and was thrown away with the turn.

## Decision

1. **A 「上下文」 tab on the 主管 page,** next to 「行动记录」; the page remembers the last tab. (Since ADR 0096 the page always opens on 「上下文」, which comes first.)
   Our own code; only the layout follows dsh-context.
2. **Current context.** The last request the Herder sent, as one bar against the working window
   (the model's context, at most 128K), split into seven parts: 系统提示词, 记忆 (the resident
   memory at the end of the system prompt), 工具定义, 折叠摘要和提示, 你的话 (owner messages,
   answers and events), 主管的回复 (text and tool calls), 工具结果. A red line marks 90 %, where
   AgentHerd folds by itself. Counts are the kernel's estimates, measured on the projection the
   Herder actually sends (`measureContext` in `packages/herder/src/context.ts`).
3. **Usage and cache.** Every request's provider usage is kept in `herd.db`
   (`herder_requests`: time, model, input, output, cache read, cache write, the estimate and its
   parts; the newest 5,000 rows). The tab shows requests, uncached input, cache hits with the hit
   rate (cache read ÷ everything read) and output, for today or the last 7 days, with a bar per
   day.
4. **Trend.** The newest 160 requests as stacked bars in the same colours; a request at least
   20 % smaller than the one before gets ✂ (usually a fold). Hovering shows the estimate next to
   what the model counted.
5. **What is in the context.** The seven parts open into their items (each tool schema, each
   message, each tool result) with tokens and the text, cut at 1,500 characters.
6. **Fold log.** The active folded blocks, newest first: topic, 主管 or 自动 (forced at 90 % or on
   overflow), messages and tokens saved, the summary, and 「看原文」 for the original messages
   (cut at 60,000 characters).
7. **Host API** `herderContext()` and `herderContextFold(blockId)`. The snapshot and folds come
   from the running Herder; with no Herder the tab says so and still shows the recorded usage.

## Alternatives

- **Count with the provider's tokens only.** The provider reports one number per request, not
  what it was made of; the split needs our own estimate. Both are shown.
- **Keep snapshots of every request.** Up to 128K of text per request; only the parts' numbers
  are kept, and the full content only for the last request, in memory.
- **Copy dsh-context's other tabs** (files, commands, fleet). They describe a coding session; the
  Herder edits no files and runs no commands.

## Consequences

- The owner can see why the Herder slowed down or forgot something, and what a fold kept.
- Usage history starts with this version; earlier days are empty.
- One more table in `herd.db` (schema 16), at most 5,000 small rows.
- After a restart the current context is empty until the Herder's next request.

## Tests

`packages/core/test/store.test.ts` (herder_requests, migration), `packages/herder/test/context-panel.test.ts`
(the seven parts, usage kept per request), `packages/host/test/host.test.ts` (usage sums),
`apps/desktop/test/herder-context.test.ts` (labels, numbers, order).
