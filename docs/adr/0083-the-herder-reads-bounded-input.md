# ADR 0083: The Herder reads a bounded amount of each input

- Status: Accepted
- Date: 2026-11-19
- Changes: [0045](0045-herder-context-folded-by-the-model.md) (folding was the only guard against a
  huge input), [0053](0053-the-herder-tells-task-results.md) (a task's whole reply went to the
  Herder)

## Context

- With files dropped on the pet ([0082](0082-task-dots-and-files-dropped-on-the-pet.md)) the owner
  asked whether the Herder should read them. It should not: the Herder keeps its whole
  conversation, and one large text would fill it. Dropped files reach it as paths only.
- Folding ([0045](0045-herder-context-folded-by-the-model.md)) helps once the conversation is
  nearly full, but a pasted log or a task's very long reply still went in whole first. The owner
  (2026-11-19): 「这个我们限制输入长度就好」.
- Tool results were already capped (`web_read` 30,000, `task_read` 40,000, `decompress` 60,000,
  memory recall 2,400 characters). What came in uncapped: the owner's message, a task's reply and
  report, events, new-work items and the owner's answers.

## Decision

1. **The owner's message: at most 8,000 characters** (`OWNER_TEXT_MAX`). A longer one keeps its
   start; the whole text is saved under `<home>/attachments/<date>-<id>-message.txt` and the message
   ends with 「[消息太长，后面 N 个字没有放进来；整段存在 <path>]」. This happens in the core,
   for Feishu and the pet alike, so a task the message goes to can read the whole file.
2. **A task's reply for the Herder to tell: at most 12,000 characters** (`VOICE_REPLY_MAX`); the
   card the owner gets still holds the whole reply, and `task_read` shows more.
3. **A report, an event, a new-work item: at most 4,000 characters each** (`EVENT_TEXT_MAX`); an
   owner's answer to a question at most 8,000.
4. Each cut says how many characters were left out and where the rest is, so the Herder knows the
   text is not whole and can fetch more with a task or a tool.

## Alternatives

- **Rely on folding alone.** It runs after the input is in; one input larger than the window still
  fails the turn.
- **Summarize long inputs with a model call first.** A second model call per long input, and the
  summary can drop what the owner meant; the start plus the file loses nothing.
- **Refuse long messages.** The owner would have to save the file themselves; AgentHerd can do it.

## Consequences

- A Herder turn has a known worst case size: the system prompt, the kept conversation, and inputs
  of a few tens of thousands of characters at most.
- A long pasted text is answered from its start unless the Herder sends a task to read the file.

## Tests

- `packages/core/test/e2e/relay.e2e.test.ts`: a very long message keeps its start and the whole is
  saved as a file.
- `packages/herder/test/input-limit.test.ts`: short text unchanged; long task reply, report, event,
  new-work item and answer cut with how much was left out.
