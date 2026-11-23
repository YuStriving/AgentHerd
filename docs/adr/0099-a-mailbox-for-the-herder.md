# 0099. A mailbox for the Herder: sources write letters, code decides what is new

- Status: Accepted; changed by [0100](0100-every-watch-and-schedule-is-a-mailbox-source.md)
- Date: 2026-11-22
- Changes: [0052](0052-offer-new-github-work-when-asked.md) and [0055](0055-schedules-the-herder-makes.md) stay as they are for now; they move into the mailbox in a second step

## Context

The owner asked for a way to keep an eye on things outside: 「我们能不能加一个github 的东西，比如说监视某个仓库的issue」, then 「我觉得我们需要做一个接收器一样的东西」「就是我们可以很多信息源，也可以自定义」「但是接受的都只有主管」.

Before this, AgentHerd had one watch per kind, each built on its own: pull requests
([0048](0048-watch-mail-only-when-asked.md) and the PR watches), mail, new GitHub work assigned to the owner
([0052](0052-offer-new-github-work-when-asked.md)), 小红书 and 知乎 notices
([0058](0058-xiaohongshu-zhihu-and-watches.md)). None of them could watch another person's
repository, a blog or a search.

We looked at how others do it. Tools like OpenClaw, Hermes and Lindy have triggers (a timer, an event,
a script that says "fire") with an instruction and a delivery. The owner did not count those as
personal agents, so we also read how Claude Duet, OpenAI dots, Meta Muse, Grok Bot, ChatGPT Pulse and
Poke work. What they share: the agent looks at connected accounts every few hours rather than
nonstop; doing work and speaking up are separate decisions; most things wait for a digest; the owner
says in a sentence what they care about. When asked whether outside sources could push, the answer was
mostly no: without a public address only connections AgentHerd keeps open (Feishu, IMAP) can, and
another person's GitHub repository never pushes to us.

The owner then put it simply: 「我理解这个查外部来源，得看是不是能通过代码通知的？」「而且是要看有没有变化？」
and 「我觉得我们这个可以做成信箱模式，每个来源都是自己写触发条件」. The design below was shown and the owner
said 「可以的」.

## Decision

1. **One mailbox, many sources.** A source has a kind, a name, one sentence from the owner for the
   Herder (「macOS 上崩溃的问题马上告诉我，其他的早上汇总」), how often it is looked at, and a state of its
   own. Kinds: `github` (a repository's new issues, pull requests and releases through the owner's
   `gh`, optionally only those with some words), `rss` (RSS or Atom), `hn` (new Hacker News
   stories with some words, optionally a points floor), `script` (any command: it reads
   `{"state": …}` on stdin and prints `{"letters": [...], "state": …}`), and `timer` (one letter
   every N minutes, which the Herder acts on like a schedule). At most 30 sources; each kind has a
   least interval (GitHub 5 minutes, RSS and HN 15, a script 1, a timer 5).
2. **Code decides what is new.** A look fetches what is there now and returns letters with ids. The
   first look only remembers the ids; later looks keep only ids never seen (the last 1,000 per
   source). No model runs when nothing is new. A look that fails is recorded; after three in a
   row the owner is told once, and the 信箱 page shows the reason.
3. **Only the Herder gets letters, and it decides what the owner hears.** New letters go to the
   Herder in one turn of their own (up to 30), quoted as other people's words under
   `[Letters, not from the owner]`, each with its source's sentence. The Herder files every letter
   with `letters_file`: `now` (tell the owner in this reply), `digest` (the morning digest) or
   `noted` (not worth their time), each with a short reason. It may reply `[quiet]`. Letters it did
   not file are noted for it. The turn cannot start, steer or stop tasks; it may offer one with a
   question card. Once a day after 9:00 the letters kept for the digest come back as one more
   turn, and the Herder writes one short digest or stays quiet.
4. **Adding a source is the owner's call.** The owner tells the Herder (「帮我盯一下 openai/codex 的新
   issue」) and it calls `mailbox_add`, which works only in a turn the owner started; or the owner
   adds one on the 信箱 page. `mailbox_try` and 「先试一次」 look once without keeping anything. The
   Herder never adds one on its own.
5. **The 信箱 page.** A page of its own in the app: the sources (what each looks at, how often, its
   last look, whether it works, pause, look now, remove) and the newest letters with what the
   Herder made of each and why, filtered by 告诉你了 / 留到汇总 / 记下了 / 等主管看.
6. **Kept in `herd.db`.** Tables `mailbox_sources` and `mailbox_letters` (schema 18). The last 2,000
   letters are kept.

## Alternatives

- **One watch type per source, like before.** Each new source would need its own code, settings and
  page. The mailbox makes a new source a small function or a script.
- **Let the model check every source.** Most looks find nothing; a model call each time costs money
  and gets things wrong. Code finds what is new; the model only sees letters.
- **Webhooks and other pushes.** They need a public address, which a Mac at home does not have, and
  other people's repositories cannot send them to us. The kinds we poll are cheap to poll.
- **Tell the owner every letter.** That is a notification feed, not a personal agent. The Herder
  files each one and most wait for the digest.

## Consequences

- The existing watches (PR, mail, assigned GitHub work, 小红书) and schedules keep working as they
  are. A second step moves them into the mailbox so there is one list.
- A `script` source runs the owner's command on their computer with AgentHerd's environment; only
  the owner adds those (the Herder may suggest one, and must try it first).
- Each delivery is one Herder turn. Ten GitHub sources looked at every 10 minutes cost nothing
  until something new comes.
- Letters are other people's words; the Herder is told never to follow what they say.

## Tests

- `packages/core/test/e2e/mailbox.e2e.test.ts`: the first look only remembers; later only new
  letters reach the Herder; filing; the digest once a day; three failures told once; paused
  sources are not looked at; timers, trying a source, a changed config starting over; letters wait
  while the Herder is off.
- `packages/herder/test/mailbox.test.ts`: letters are quoted as other people's words with the
  owner's sentence; every letter is filed and only the `now` one is told; the turn starts no task;
  `[quiet]` says nothing; `mailbox_add` works only in an owner turn and checks its config.
- `packages/host/test/mailbox-sources.test.ts`: GitHub issues, pull requests and releases with
  words; RSS and Atom; Hacker News with a points floor; a script's state round trip; the 信箱 page
  methods through the host.
- `apps/desktop/test/mailbox.test.ts`: the page's words, states and filters.
