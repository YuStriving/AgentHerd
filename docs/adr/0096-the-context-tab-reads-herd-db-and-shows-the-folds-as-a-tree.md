# 0096. The 上下文 tab reads herd.db and shows the folds as a tree

- Status: Accepted
- Date: 2026-11-21
- Changes: [0093](0093-the-herders-context-panel.md) (what the tab shows and where it reads it), builds on [0095](0095-the-herders-conversation-in-tables-and-folds-that-nest.md)

## Context

ADR 0093's tab read the running Herder: after a restart it showed nothing until the next request,
and while the Herder was off it showed nothing at all. Its seven-day chart was mostly empty and its
trend had three bars. The owner said 「这个页面做的好丑」 and 「我觉得我们主管这个context统计肯定是直接读我们的数据库？」;
after ADR 0095 put the conversation, the requests and the folds into tables, they asked to see
「哪些段被折叠了，整个上下文的状态」, a clearer tree (「我们的这个tree要清晰一点」) and
「我们也可以真的展示一颗树？都行，好看清晰」.

## Decision

1. **The host answers from herd.db alone** (`packages/host/src/herder-context-view.ts`). It
   rebuilds the next request the way the Herder does: the newest kept system prompt with its tools,
   the conversation from `herder_messages`, the kernel's bookkeeping and the fold rows, through
   the same `HerderContext.project`. So the tab works with the Herder off and right after a
   restart, and shows the same thing the Herder will send. A fold the next request would make by
   itself (90 % full) shows as 「下次请求时才折」. A compress call carries its fold's summary, so it
   and its receipt count as 折叠摘要, not as the Herder's replies, and a fold's summary is said to be
   read in its call whenever the rebuilt request still carries that call (even when the call sits
   inside a later fold).
2. **One call, cached by a key.** `herderContext(known?)` returns the whole view with a key made
   of the tables' counts and newest ids; passing the key back returns `{unchanged: true}` while
   nothing was written, so polling every 5 s costs one small query. Messages are read a round at a
   time with `herderMessages(from, to)` (200 at most, each cut to 2,000 characters) and a fold's
   originals with `herderContextFold(blockId)` (60,000 characters).
3. **What the tab shows**, top to bottom:
   - 现在送给模型的: the size against the working window by part, the 90 % line, and four facts
     (the whole conversation, the folds and what they save, the messages read as they were, the
     last request and its cache hits).
   - 上下文地图: the whole conversation above and what is sent below, on one scale, joined by
     ribbons; folds are orange, stretches read as they were are blue. A click shows the fold: its
     time, what it holds by kind, size before and after, who folded it, where the model reads the
     summary (in its compress call, as a note in its place, inside the fold that took it in), the
     summary and its originals.
   - 上下文树: in the model's reading order, the opening parts (system prompt, tools, memory, each
     opens to its pieces), then each fold with the folds it took in and its rounds, then each
     stretch with its rounds; a round opens to its messages. A second view, 树图, draws the same
     tree left to right: the request, the opening, each fold and stretch, and the folds inside a
     fold further right (dashed when merged). Choosing a fold on the map selects it in the tree.
   - 每次请求: one bar per request (cache hits and the rest, failed ones red) with ✂ where a fold
     was made; 每天用量: per local day with requests, input, hit rate, output and cost.
   - 折叠记录: folds made (by the Herder, forced, overflow; merged or opened later), starts, and
     straightened ranges, newest first.

## Alternatives

- **Ask the running Herder.** It is what ADR 0093 did; it shows nothing when the Herder is off or
  just restarted, and two processes would own the same numbers.
- **Draw only the indented list.** It reads well for long conversations but does not show at a
  glance which folds hold which; the drawn tree does, and it stays small because rounds are left
  out of it.
- **Recompute the view on every poll.** Rebuilding a long conversation through the kernel takes
  tens of milliseconds to seconds; the key keeps it to once per change.

## Consequences

- The host depends on `@agentherd/herder` for the rebuild (it already did for models).
- A conversation of thousands of rounds sends at most 600 rounds, 500 requests and 400 events to
  the tab; messages come a round at a time.
- Old requests (before ADR 0093) have no parts; their bars have one colour.

## Tests

`packages/host/test/herder-context-view.test.ts` (the request rebuilt and a fold placed where the
model reads it; usage per day with cost and hit rate; no kept prompt yet; messages paged and a
fold's originals), `packages/host/test/host.test.ts` (built from herd.db, `unchanged` until
something is written), `apps/desktop/test/herder-context.test.ts` (map on one scale, tree in
reading order with nested folds, the drawn tree's layout, where a summary is read, fold marks and
the record list).
