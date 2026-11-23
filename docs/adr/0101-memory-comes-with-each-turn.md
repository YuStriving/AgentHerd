# 0101. Memory comes with each turn, and is kept from the conversation by role

- Status: Accepted
- Date: 2026-11-22
- Changes: [0038](0038-herder-memory.md) (no resident snapshot; reviews by tokens and by role;
  preferences need no lasting marker), [0090](0090-memory-jobs-use-a-model-that-answers.md)
  (reviews read more at a time and see what is kept), [0091](0091-the-owners-profile-card.md)
  (the card comes with every turn instead of the system prompt)

## Context

The owner: 「我理解是我们的记忆不起作用。。。」. The numbers on 2026-11-22 agreed: over 120 owner
messages and 41 reviews, memory held 4 entries. Reviews dropped what they found because the
evidence was not the owner's exact words or had no 「以后」; the Herder called `memory` once and
`memory_search` never. When the owner corrected it (「这个 issue 里面其实有 pr，只不过被拒绝了」) it
said 「下次我也留意」 and kept nothing. Recall ran only on owner messages, so a timer or a letter
never saw what had been learnt, and a task's lesson was filed under the task's copy of the
project, where no later task looks.

Memory sat at the end of the system prompt and was rebuilt after an hour idle; the owner pointed
out that it changes often and that putting it there breaks the prompt cache
(「不用决定，代码每次放进系统提示词 这些会经常改的啊。。。。」). A first idea, a frozen prompt with
updates appended, was turned down: 「我觉得没道理的，还是得参考openviking」. The plan below follows
OpenViking (notes in the `openviking-memory` write-up) and was agreed: 「可以的」.

OpenViking keeps memory out of the system prompt. Its OpenClaw plugin looks memory up when a
prompt is assembled and adds up to 6 entries (≤4,000 characters) for that request; extraction runs
when a session is committed (about half the context budget), reads user messages for the profile,
preferences, entities and events and the agent's messages for cases and patterns, prefetches what
is kept on the same topics and answers create / edit / delete.

## Decision

1. **No memory in the system prompt.** It holds the rules and connected accounts and changes only
   when an account does, so the prompt cache holds. A prompt from before this change that still
   carries memory is rebuilt once.
2. **Memory comes with each turn.** Code looks up what the turn is about: the owner's words, a
   question and its answer, a timer's job, the letters' sources and titles, a task's result. It
   appends to that turn's message, after the time line, the profile card and up to 6 entries of
   any other kind scoring at least 0.45 (≤4,000 characters), as 「[记忆召回 · 只在这一轮带着；…]」.
   When the turn is over the block is taken out of the message, so it is never saved and the next
   turn carries only its own; the cache re-reads only the last round. The 上下文 tab counts it as
   memory.
3. **Kept from the conversation by role.** A review runs once about 20,000 tokens came in since the
   last one, after 10 idle minutes, or when the conversation is folded. The owner's lines give the
   profile, preferences, people and projects; the Herder's own work and the owner's corrections of
   it give lessons (`experience`). The review sees the card and up to 12 related entries with ids
   and answers add / replace / remove: one topic stays one entry, and the same words twice are
   dropped. Decisions stay with the Herder and the owner, because a decision lets steps run without
   asking.
4. **Fewer gates, the same safety.** A preference needs the owner's words but no 「以后」; only a
   decision needs words that settle it. Lessons, notes and projects carry what happened in the
   Herder's words and never count as the owner's. Paths are kept only when the owner typed them;
   temporary folders, task results and secrets never.
5. **The Herder keeps a lesson at once** when the owner corrects it or it promises 「下次…」, in the
   same turn, instead of waiting for a review.
6. **A task's lesson belongs to the owner's project**, not the folder of the task's copy, so the
   next task in that project finds it.

## Alternatives

- **A frozen system prompt with 「[记忆更新]」 lines appended.** Keeps the cache too, but memory
  still grows with the conversation and stays stale until the next fold; the owner turned it down.
- **Let the Herder decide when to search.** It never did (0 searches in 154 calls).
- **Keep 「以后」 and verbatim evidence for everything.** Safe and nearly empty, which was the problem.

## Consequences

- The system prompt is the same request after request; only a connected account changes it.
- Each turn costs one local search (vectors when the model is loaded, keywords otherwise) and up to
  4,000 more characters in that turn only.
- More is kept. The 记忆 page and its undo stay the way to remove what should not be there.
- Reviews read up to 80 lines or 24,000 characters at a time, so a long conversation is reviewed in
  fewer, larger calls.

## Tests

`packages/herder/test/memory.test.ts` (checks, a turn's memory, the system prompt never holding it,
the block stripped after the turn, a timer turn's recall, the review trigger),
`packages/herder/test/memory-jobs.test.ts` (role-based review, lessons from corrections, replace
by id), `packages/herder/test/memory-vectors.test.ts` (score floor),
`packages/herder/test/context-panel.test.ts` (the 上下文 tab counts a turn's memory),
`packages/core/test/e2e/follow.e2e.test.ts` (a lesson names the owner's project).
