# 0088. The Herder cares, and writes Chinese like a person

- Status: Accepted
- Date: 2026-11-20
- Changes: [0065](0065-one-herder-voice-and-a-trail-only-herder-page.md) (the one voice),
  [0054](0054-say-what-matters.md) (what "no pleasantries" covers)

## Context

At 01:55 the owner asked the Herder 「用一句话说说现在几点了？」 and got
「现在是 11 月 20 日凌晨 1 点 55 分，已经算凌晨了。」. The owner: 「我觉得我们这个管家目前还有个问题是不太
拟人化？」 and 「这里其实我希望能回复一个早点睡」.

The Herder knew the time: every turn starts with a `[Now: …]` line. Its voice (ADR 0065) said
"say what matters … no pleasantries, nothing the owner already knows" and "never nag", so it
treated any word of care as filler.

The owner also pointed to [Da1sypetals/AGENTS.md](https://github.com/Da1sypetals/AGENTS.md), one
person's rules for how an agent writes Chinese: no 「不是……而是……」 when nothing is compared, no
opening or closing summaries, no jargon (落地、对齐、钉死), full two-character words, no plans in
front of the answer, nothing about what was ruled out, no trace of a corrected mistake, no remarks
on how much work something is. The repository has no license, so its text is not copied; the
rules below say the same things in our own words.

## Decision

1. **A line of care when there is a reason.** `stylePrompt()` says the Herder cares about the
   owner as a person. After the answer it adds one short line when it sees a reason: late at
   night (below), or the owner said they are tired, ill or upset, have been at it for hours, or
   something they cared about failed. One line at most, never on every reply, never the same
   reminder twice in one day or night. "No pleasantries" now means empty politeness
   (「好的！」「希望对你有帮助」); care is not a pleasantry.
2. **Late at night is said, not worked out.** From midnight to 5 a.m. the time line ends with
   `late at night: end your reply with one line telling the owner to get some sleep, unless a
   reply since midnight already did`. The voice has the same rule with two examples: a reminder
   after a short technical answer, and none on the next question once it was said.
3. **Chinese that reads like a person wrote it.** The voice lists the writing rules above, in
   our words.

## Measured

`deepseek/deepseek-flash` (the owner's Herder model), the real system prompt, 4 runs per case:

| Case | Before | After |
| --- | --- | --- |
| 01:55 「用一句话说说现在几点了？」 | 0 of 2 said to sleep | 4 of 4 |
| 15:10, the same question | none | none (0 of 4) |
| 02:10, a second question after the Herder already said it | — | not repeated (0 of 4) |
| 21:30 「今天改了一天 bug 好累……」 | — | care in 4 of 4 |
| 01:30, a git question | — | 0 of 4 said to sleep |

The model follows the rule for a short chat question but still answers a technical question at
night without the line. Tried and dropped: the rule without examples (at best 1 of 3 for the time
question), and the reminder as a note after the owner's message (0 of 3).

4. **No 「。」 at the end of a line** (changed 2026-11-20). The owner, on the reply
   「现在 11 点 33 分；感冒了就别熬太晚，把药吃了、早点歇。」: 「不要加句号」. People do not end a
   chat line with a period. The voice says so, and `withoutEndPeriods()` drops a 「。」 that ends a
   line before the reply is said or stored, so it holds even when the model forgets. Periods
   between sentences in a line stay; code and herd-ui blocks are left as they are.

## Alternatives

- **AgentHerd adds 「早点睡」 itself after the reply.** Always there, but it reads like a machine
  stamp and ignores what was said.
- **Remember the owner's hours and message first when they are up late.** Proactive and needs
  memory of habits; left for later.

## Consequences

- The voice part of the system prompt grows by about 1,800 characters; it is the same for every
  turn, so the prompt cache still holds.
- The time line changes only between midnight and 5 a.m.; it is per message, so the cache is not
  affected.

## Tests

`packages/herder/test/style.test.ts` (no 「。」 at a line end), `packages/herder/test/memory.test.ts` ("the time line says when it is late at night"),
`packages/herder/test/herder.test.ts` (the voice holds the care and writing rules).
