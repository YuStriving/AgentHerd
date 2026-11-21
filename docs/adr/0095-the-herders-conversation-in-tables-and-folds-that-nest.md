# 0095. The Herder's conversation in tables of its own, and folds that nest

- Status: Accepted
- Date: 2026-11-21
- Changes: [0045](0045-herder-context-folded-by-the-model.md) (where the folds are kept; a fold may not cut into another), [0093](0093-the-herders-context-panel.md) (where the numbers come from)

## Context

The 上下文 tab of ADR 0093 showed little: the current context lived only in the running Herder
(gone after a restart), usage came from `herder_requests`, which started with that ADR and had
three rows, and the folds came from the kernel's state. The owner asked: 「我觉得我们主管这个
context统计肯定是直接读我们的数据库？」, then 「我们主管的数据库是咋存的，存在哪，扩展性咋样」,
and after the review: 「破坏性改动也可以，目前还没什么人使用，但我希望我们可以清楚的看清楚哪些段被折叠了，
整个上下文的状态」, 「我们的这个tree要清晰一点」.

What `herd.db` held (the owner's copy, 2026-11-21):

- `herder_log(seq, message_json)`: 620 messages, 633 KB. Nothing but JSON: no time, no kind, no
  size, no round. Every question about the conversation meant parsing every row.
- `state` key `herder.context`: the kernel's whole state, 66 KB, rewritten after every turn. The
  folds were only in there; a fold that was taken into a bigger one, or opened, left no trace.
- The provider's usage was on every assistant message in `herder_log` (297 replies since
  2026-11-04), but `herder_requests` had only the three since ADR 0093.

The folds themselves had a problem. b3 was asked for m00271–m00410, which cuts through b2
(m00246–m00407). The kernel took in no block (b2 was not wholly inside) yet recorded b3 as covering
#264–#392: two active folds claimed the same 126 messages. What the model saw was right (b2 came
first), but nothing could draw that as a tree.

## Decision

1. **The conversation gets its own tables** (schema 17, `packages/core/src/herder-store.ts`):
   - `herder_messages(seq, at, role, kind, tool, round, tokens, chars, message_json)` replaces
     `herder_log`. `kind` is owner / task / event / answer / scheduled / intake / other for
     prompts, reply / call for the Herder, result for tool results; `round` is the seq of the
     prompt that started the round; `tokens` counts like the kernel (`countTokens`).
   - `herder_rounds(seq, at, kind, title)`: one row per prompt, with a short title (the owner's
     words, 「修登录 401」finished its turn, the answer).
   - `herder_requests` again, one row per model call: seq of its reply, round, model, input,
     output, cache read and write, cost, size, working window, parts (when measured), prompt
     hash, failed. It keeps
     every row; the upgrade fills it from the usage on the stored replies.
   - `herder_folds(block_id, parent, level, state, made_by, topic, summary, start_seq, end_seq,
     direct_start, direct_end, messages, call_seq, tokens_before, tokens_after, created_at,
     updated_at, block_json)`: a fold is a row and is never deleted. `state` is active, merged
     (taken into its parent) or opened; `made_by` is herder (its compress call is at `call_seq`),
     forced (90 % full) or overflow (the provider refused).
   - `herder_events(at, kind, round, data)`: start, fold, fold.repaired.
   - `herder_prompts(hash, at, tokens, system, tools_json)`: each system prompt with its tools,
     once per change (200 kept), so the next request can be rebuilt from `herd.db` alone.
   - The `herder.context` state keeps only the kernel's bookkeeping (refs, counters, nudges); the
     folds are saved with it in one transaction.
2. **Folds nest.** A compress range must take in whole folds or none of one. A range that cuts
   into an active fold is refused before the kernel sees it, with what to do: 「m00271–m00410 cuts
   into b2 (m00246–m00407). A fold takes in whole folds or none of one: start at m00246 or
   earlier to take b2 in, or keep the range outside m00246–m00407.」 Other ranges in the same
   call still fold.
3. **Old cuts are straightened on start.** A fold that cuts into an older active one keeps only
   what it folded itself, but only when what the model is sent stays byte for byte the same
   (checked with the kernel's `prune`); else it is left and audited. On the owner's copy b3
   became #390–#392 and the 257,528-character request did not change.
4. **The upgrade copies the database first** (`herd.db.v16-<time>.bak`, `VACUUM INTO`), then
   moves `herder_log` into the new tables in one transaction (30 ms for 620 messages).

## Alternatives

- **Keep `herder_log` and add a side table.** Every reader would still parse JSON to learn a
  message's kind or size, and two writers would have to agree.
- **Read the kernel's state for the folds.** It holds only the latest picture; merged and opened
  folds vanish, and it is one 66 KB blob rewritten every turn.
- **Fix the overlap inside the kernel.** The kernel is a copy we keep close to upstream
  (`packages/context-kernel/UPSTREAM.md`); the check sits in front of it instead.

## Consequences

- The 上下文 tab can read everything from `herd.db` with plain queries (next step).
- Writes per turn: the changed messages and rounds, one request row per reply, the changed folds
  (the kernel ages its blocks each turn, so active folds are rewritten; there are a handful).
- An old AgentHerd cannot open a schema-17 `herd.db`; the copy from before the upgrade can.

## Tests

`packages/core/test/store.test.ts` (version-16 upgrade with kinds, rounds, requests and the copy;
rounds rewritten with the messages; folds saved with the bookkeeping and never deleted; events and
prompts), `packages/herder/test/context.test.ts` (token counts equal the kernel's; fold rows and a
restart from them; a cutting range refused; an old cut straightened with the view unchanged; the
prompt hash), `packages/herder/test/context-panel.test.ts` (requests carry their seq and round).
