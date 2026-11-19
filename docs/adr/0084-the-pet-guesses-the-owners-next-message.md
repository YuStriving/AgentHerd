# ADR 0084: The pet guesses the owner's next message

- Status: Accepted
- Date: 2026-11-19
- Changes: [0070](0070-a-desktop-pet.md) (the pet's input)

## Context

- Claude Code shows a grey guess of the next prompt in its empty input; DSH has a community plugin
  doing the same (`@studyzy/dsh-suggest-prompt`), and Codex had a three-PR stack for it
  (openai/codex#24126, #24127, #23976; closed by the stale bot, never merged). The owner
  (2026-11-19): 「codex还有dsh都有类似的插件，就是帮你想下一句应该怎么问的功能」.
- The DSH plugin sends a separate prompt ("you are a prompt suggestion generator") with only the
  last question and answer. Codex sends the same request the turn sent — the same system prompt
  and recent history — plus one instruction, so the provider's prompt cache answers the prefix.
- The owner chose the Codex way, for the pet only: 「照 Codex：带主管自己的系统提示词和最近一段对话，
  末尾加一条中文版指令…第一轮不出；拿回来时对话已经变了就丢掉；8 秒超时。…先只做桌宠吧」.

## Decision

1. **When.** After the Herder's reply to the owner (a message, an answer, a schedule) and after it
   tells a task's result. Not after its first reply in the conversation; not when the reply offers
   answers (`choices`) or the Herder asked with `ask`; not for new-work items; not when the owner
   turned it off (设置 → 桌宠 → 猜你下一句, on by default) or the pet is off.
2. **What the model sees.** The folded view the turn's last request carried (system prompt, tools,
   conversation), the reply it got, and one more user line: a Chinese (or English) instruction —
   predict what the owner would type next, not what they should do; the test is 「我正要打这句」;
   no praise, questions, the Herder's voice, new ideas or several sentences; stay silent when the
   next step is not obvious; one line of 2 to 20 characters. The prefix equals the last request,
   so it is a cache hit. No tool may run (`toolChoice: "none"`), at most 32 output tokens, thinking
   off as for the Herder, given up after 8 seconds.
3. **Filtered.** One pair of quotes and a trailing full stop are taken off; dropped when empty or
   silent (无 / 没有建议 / no suggestion), on several lines, a question, formatted (list, bold, code),
   labelled (建议：), praise (谢谢 / 不错), the Herder's voice (我来 / 让我 / let me), over 40
   characters, or a lone word that is not a plain yes (好 / 继续 / 可以 / ok …). Rules from Codex's
   filter and the DSH plugin's Chinese lists.
4. **Stale is dropped.** A new turn of the Herder aborts the request; a result that comes back after
   the conversation changed is thrown away. The host clears the guess when any line is added to
   the conversation and hides it while a card that came after it waits for the owner.
5. **Never kept.** The instruction and the guess are not part of the Herder's conversation or
   `herder_turns`; the host holds the latest guess in memory and sends it in `PetView.suggestion`.
   An audit row `herder.suggestion` records whether one was shown, whether it was stale and the time
   taken.
6. **In the pet.** The guess is the placeholder of the empty input, with a small 「Tab」 key beside
   it. Tab or a click on the key puts it in the input; it is never sent by itself. Typing hides it;
   clearing the input shows it again. Feishu gets nothing.

## Alternatives

- **The DSH way: a separate generator prompt with the last exchange only.** Cheaper input, but no
  cache hit, and the guess knows nothing of the owner's earlier messages or the Herder's rules.
- **A cheap model of its own.** The Herder's model is already the cheap one the owner chose, and
  another model would lose the cache.
- **Two or three guesses as buttons.** More to read in a small panel; Claude Code and Codex show
  one.
- **Feishu too.** A card per guess would ring the phone; left out for now.

## Consequences

- One small extra request per reply: the instruction and up to 32 tokens on top of a cached prefix.
  A real run on the owner's conversation (deepseek-flash) took 1–6 seconds and gave lines like
  「阿里和拼多多的也查一下」「晚上再给我查一次」; a turn after a very long message timed out and
  showed nothing.
- The guess is the model's; a bad one costs a glance, never a sent message.

## Tests

- `packages/herder/test/suggest.test.ts`: the filter keeps and drops; the hidden request asks for
  32 tokens with no tools and gives up after the timeout; not after the first reply; after the
  second it is the same request plus the instruction, and nothing is kept in the conversation; not
  when the reply offers answers or it is turned off; a guess the owner's next message overtook is
  dropped.
- `packages/host/test/host.test.ts`: the guess is in `PetView` until anything is said or a newer
  card waits; the setting turns it off.
- `apps/desktop/test/pet-state.test.ts`: shown only in an empty input while the chat is up.
