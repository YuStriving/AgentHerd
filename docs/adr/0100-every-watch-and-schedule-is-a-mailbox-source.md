# 0100. Every watch and schedule is a mailbox source

- Status: Accepted
- Date: 2026-11-22
- Changes: [0048](0048-watch-mail-only-when-asked.md), [0052](0052-offer-new-github-work-when-asked.md), [0055](0055-schedules-the-herder-makes.md), [0058](0058-xiaohongshu-zhihu-and-watches.md), [0064](0064-permission-follows-the-work-and-intake-starts-on-trial.md), [0099](0099-a-mailbox-for-the-herder.md)

## Context

[ADR 0099](0099-a-mailbox-for-the-herder.md) gave the Herder a 信箱 and left the older watches
for a second step. After the first live test the owner asked for it: 「测试一下吧，就用我的主管，第二步这里也改进一下」.

Before this step AgentHerd had five things that look outside or wake the Herder at a time, each
built on its own: mail watches (Gmail through Composio), new GitHub work assigned to the owner
(`intake_watch`, with offers and a trial run), 小红书 and 知乎 notices, schedules, and the new
mailbox. Each had its own table or state key, its own poll loop, its own Herder tools, its own
first-look rule, its own failure handling and its own place in the app (定时任务 → 在盯的, the
定时任务 list, 应用连接 › 账号). The owner had to know which one a wish belonged to, and the Herder
had nine tools for what is one idea: 「告诉我外面的这件事」 or 「到点做这件事」.

## Decision

### 1. One kind of thing: a source in the 信箱

Mail, new GitHub work, platform notices and schedules become mailbox source kinds next to
`github`, `rss`, `hn` and `script`:

| Kind | Looks at | Letter id |
| --- | --- | --- |
| `work` | `gh search issues --assignee=@me` and/or `gh search prs --review-requested=@me`, optional repository and label | the item's address |
| `mail` | a Gmail search through Composio, from when the source was made | Gmail's message id |
| `social` | 小红书 or 知乎 comments and @; skipped (not a look) while the account is signed out; after the first look the notice list is opened only when something is unread | the notice id |
| `timer` | nothing: daily at a time (on some days), every N hours, or once | the minute it was due |

They share what 0099 gave every source: code decides what is new, the first look only remembers,
three failed looks in a row are told once, the owner's sentence goes with every letter, the
信箱 page lists them with their letters. Social sources are looked at about every 20 minutes with
±5 minutes of spread, as before.

### 2. What a new letter does is the source's `act`

- `sort` (default): the Herder files it as tell now, digest or noted (0099).
- `offer` (default for `work`): each letter is sent as a question card with 「开任务」「忽略」;
  「开任务」 gives the Herder an intake turn with the letter's line. It does not go to the
  Herder for sorting.
- `auto`: work starts by itself, but first on a trial run (`trial`, ADR 0064): offers as above,
  and the Herder says what it would have started. When the owner says so (「放开」) the Herder
  calls `mailbox_change` with `trial: false`; from then on each letter goes straight to an intake
  turn with a line 「按你的规则开工（信箱「x」）：…」.

Offered and started letters are filed `now` with why (「问你要不要开任务」…), so the 信箱 shows
them too.

### 3. Timers are sources whose letters are the owner's words

A timer has `config.when` (the `ScheduleWhen` of ADR 0055) and its sentence is the job. At its
time the Herder gets a scheduled turn with that sentence as the owner's words, exactly as a
schedule did: it may answer, start a task, or stay quiet. Missed times run once on start; a `once`
timer is removed after it ran. A timer has no `everyMinutes`; the page shows its next run.

### 4. Old rows move, old tables go

Schema 19 adds `act` and `trials` to sources and `ref_json`, `answer` to letters, then moves
`schedules` → timers (ids kept, next and last run kept), `intake_watches` → `work` (auto watches
keep their trial count), `mail_watches` → `mail` (paused kept), and the state key `social.watch`
→ one `social` source per platform whose comments were on; seen ids come along so nothing is told
twice. The old tables and key are dropped. The database is backed up before (0095).

### 5. One set of Herder tools

`schedule_add/change/remove`, `intake_watch/unwatch`, `mail_watch/unwatch` and `social_watch`
are gone. `mailbox_add`, `mailbox_change`, `mailbox_try`, `mailbox_list`, `mailbox_remove` take
every kind, `when` for timers, `act` and `trial`. Only an owner turn adds, changes or removes.
`session_list` lists the sources.

### 6. One place in the app

The 定时任务 page is gone; old links open the 信箱. The 信箱's add dialog has all eight kinds,
a time editor for timers and 「新信怎么处理」 (主管看着办 / 每封都问我 / 直接开任务). The pull
requests tasks opened (ADR 0051) are not sources — they belong to their task and wake it — and
are listed under 「任务开的 PR」 on the same page. 应用连接 › 小红书's 「告诉我评论和@」 switch now
pauses or resumes that platform's social source.

## Alternatives

- **Keep the old watches and add mailbox kinds beside them.** Two ways to do one thing; the
  Herder would keep choosing between them.
- **Make pull requests a source too.** A PR's news wakes the task that opened it and is counted
  per task (ADR 0051); as letters to the Herder it would lose that.
- **Let timers be letters the Herder sorts.** A timer is the owner's own instruction, not outside
  news; sorting it would let the Herder drop it as 「记下了」.

## Consequences

- One loop looks at everything; one table keeps it; one page shows it.
- Mail and work sources count their own failures; source health (0050) keeps only `github` for
  pull requests.
- A social source needs a signed-in account; while signed out it is skipped without failing.
- Existing Herder conversations still mention the old tool names; the new system prompt names only
  the mailbox tools.
- Found in the live test of 0099 (2026-11-22): sorting real openai/codex letters, the Herder filed
  all four as digest with sound reasons but answered 「[安静]」 instead of `[quiet]`, and that reached
  the owner as a message twice. A translated marker on a line of its own (「[安静]」「【静默】」) now
  counts as quiet for letters, timers, resumed turns and voice, the prompt says the marker is
  written in English, and the pet hides such old lines.

## Tests

- `packages/core/test/e2e/mailbox.e2e.test.ts` — E2E-MAILBOX-ALL: timers (every, missed runs once,
  once removed), offers and the tap, trial then auto, social skipped and spread.
- `packages/core/test/store.test.ts` — the schema 19 move from a version 18 database.
- `packages/host/test/mailbox-sources.test.ts` — work, mail and social looks.
- `packages/host/test/host.test.ts` — timers and work through the host API.
- `packages/herder/test/tools.test.ts`, `packages/herder/test/mailbox.test.ts` — the tools.
- `apps/desktop/test/mailbox.test.ts` — the page's words.
