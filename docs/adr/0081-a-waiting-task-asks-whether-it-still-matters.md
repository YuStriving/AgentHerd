# ADR 0081: A task that waits on the owner asks whether it still matters

- Status: Accepted
- Date: 2026-11-19
- Changes: [0039](0039-tasks-kept-and-continued.md) (an ended task keeps its stage),
  [0072](0072-cards-in-the-pet.md) (停止 on a task)

## Context

- A task said in its `herd_report` that it waits for the owner — 「查最近的未读邮件」 needed a
  Feishu sign-in within 10 minutes. The owner did not see it in time. An hour later the idle timer
  ended the agent ("no prompt for 60 minutes"), but ending never changes a task's stage, so the
  task stayed 「等你」 for good: on the board, on the pet's 任务 page as running, and after every
  restart. 停止 in the pet did nothing either, because the task had already ended.
- The owner (2026-11-19): 「我现在这里有个正在等待的任务，一直没执行，我们每个任务都应该有个时间，如果过了
  很久一直没回答，那应该提醒用户，问还要不要去做」.
- Approvals already have their own clock: one reminder after 30 minutes and a timeout after 60
  ([0056](0056-leaving-the-mac-asks-and-questions-close.md)). What had none is a task whose own report said
  it waits.

## Decision

1. **Asked once after half an hour.** A task whose stage is 「等你」 because of its report (not an
   open approval card) and that has not changed for 30 minutes gets one question to the owner,
   sent like any card (Feishu and the pet):
   「「查最近的未读邮件」在等你回复，已经 40 分钟 了：<what it said it waits for>　还要做吗？」 with
   **还要做** and **不做了**. Waiting is counted from the task's last change, so a task that waited
   before a restart is asked about as soon as AgentHerd is back.
2. **还要做** sends the task back to work with a fixed prompt: the owner still wants it; what it
   waited for may have gone stale (a sign-in link, a code, a QR code), so redo that step and tell
   the owner what to do now. An ended task opens again as any follow-up does
   ([0039](0039-tasks-kept-and-continued.md)).
3. **不做了** stops the task: its agent ends if it still runs, the task stops waiting and shows as
   没做成 with 「你说这个任务结束了」.
4. **No answer for a day** stops it the same way, with 「等你回复等了一天，没有回复」; the question
   says so instead of its buttons.
5. **Asked once per wait.** After an answer the task is asked again only if it later waits again.
   A question whose task went on or was stopped some other way closes with 「这件事已经处理了」.
6. **停止 also lets a waiting task go.** Stopping a task (pet, app) that already ended while it
   waited now makes it stop waiting, the same as 不做了.
7. The look runs every minute, only while some task waits or a question is open, and not in a
   one-off `agentherd run` beside a host (those tasks are the host's). The waiting tasks and their
   questions are kept in herd.db state `tasks.waiting`, so a restart neither asks twice nor
   forgets the day.

## Alternatives

- **End waiting tasks silently after a while.** The owner asked to be asked; a sign-in can still
  matter tomorrow.
- **Remind again and again.** One question plus a day is enough; the pet and notifications
  already show what waits.
- **Let the Herder decide when to ask.** It would need a model call per look for a plain clock
  rule; the Herder still sees the answer as the task's next prompt.
- **Change the idle timer to restage the task.** Ending an agent is not the owner deciding; the
  task should still wait until they say.

## Consequences

- The one task that waited since 2026-11-18 is asked about once after the update.
- One more kind of card the owner may get; it closes itself when the task moves on.

## Tests

- `packages/core/test/e2e/waiting.e2e.test.ts` (E2E-TASK-WAIT-ASK): asked once after half an hour
  with what the task waits for; 还要做 sends it back to work; 不做了 stops it and it is not asked
  again; a day without an answer stops it; after a restart a task that waited before is asked at
  once, and 停止 on it makes it stop waiting; how long is said in the owner's words.
- `packages/core/test/e2e/restart.e2e.test.ts`: a one-off run beside a host asks nothing.
