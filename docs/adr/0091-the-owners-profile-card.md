# 0091. The owner's profile card, and a first run that asks a name and a figure

- Status: Accepted
- Date: 2026-11-20
- Changes: [0038](0038-herder-memory.md) (a new resident kind `profile`; reviews may write it),
  [0070](0070-a-desktop-pet.md) (the figure is picked in the first run)

## Context

The owner: 「我感觉我们的记忆不太生效，还有就是我们需要人物画像这个记忆类型？比如说对于当前的boss」.
After [ADR 0090](0090-memory-jobs-use-a-model-that-answers.md) made reviews work again, they read
all 284 lines said since 2026-11-09 and still kept nothing about the owner. The `owner` kind takes
a preference only with a lasting marker (以后, 默认, 记住, …). 「我在做 AgentHerd」 or 「我一般半夜还在写代码」
have none, so the Herder never learned who it talks to.

About the first run the owner said: 「我们引导现在做的很垃圾，最开始应该先是输入自己的昵称……比如我叫我借此火，可以喊你火哥这种，当然昵称这些都可以跳过，然后选择主管形象」.
Asked whether gender matters, the owner agreed to drop it, and wanted the name in the first run,
skippable (「就放在引导吧，也可以跳过」).

Where the Herder sees the card: the owner chose option A, the card at the end of the system
prompt with the other resident memory (「可以的，A」), over adding it only when recall finds it.

## Decision

1. **A new memory kind `profile` 画像.** One entry per field, written 「<field>：<value>」. The fields
   are fixed: 称呼, 身份, 在做, 作息, 回答方式, 喜好, 在意. Adding a field that already has an entry
   replaces it (the old one is kept as superseded), so the card stays one line per field.
2. **No lasting marker.** A profile entry still needs evidence: the owner's own typed words,
   verbatim, not a question (same rules as `owner`). It does not need 「以后」: what the owner says
   in passing about themselves is enough.
3. **Resident, first.** `profile` is a resident kind with a cap of 600 characters, put first in
   the memory snapshot of the system prompt as 「主人画像」. The Herder calls the owner by the 称呼
   now and then, like a friend would, not in every reply and never in card titles.
4. **Kept current by the Herder and by reviews.** The `memory` tool takes `profile`; the review job
   now proposes profile, owner, person and project entries, profile first.
5. **The owner sees and edits it.** The 记忆 page shows 「你的画像」 first: every field, empty ones
   as 「还不知道」, with source, date and evidence. A field can be edited in place (at most 60
   characters) or cleared. An edit is the owner's own (`owner_edit`).
6. **The first run asks two things before Feishu.** 「主管怎么叫你？」 with one input (no gender),
   then 「选主管形象」 with the two figures. Both can be skipped. A name typed before the herd runs
   is kept in `config.json` (`profileWaiting`) and written to the card when the herd starts.

## Alternatives

- Keep `owner` and drop its marker rule: it would mix lasting instructions (「回复用中文」) with facts
  that change (what the owner works on now), and it has no fields to update in place.
- Gender in the first run: the owner found no use for it.
- The card only by recall (option B): the Herder would not know the name on a turn where nothing
  matched, e.g. late at night.

## Consequences

- The system prompt grows by up to 600 characters; a profile write changes it on the next rebuild,
  like other resident memory.
- Old reviews already passed the lines from before this change; the card fills from new
  conversation, the Herder's own writes, and what the owner types on the 记忆 page.

## Tests

- `packages/core/test/memory-store.test.ts` (a field replaces its old entry; caps)
- `packages/herder/test/memory.test.ts`, `packages/herder/test/memory-jobs.test.ts`
  (no marker needed; field and evidence checks; snapshot order; reviews write it)
- `packages/host/test/host.test.ts` (a name before the herd runs waits in config and is written on
  start; clearing removes the entry)
- `apps/desktop/test/profile.test.ts` (rows of the card)
