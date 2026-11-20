# 0089. The Herder knows which accounts are connected

- Status: Accepted
- Date: 2026-11-20
- Changes: [0058](0058-xiaohongshu-zhihu-and-watches.md) (how the Herder learns about the accounts)

## Context

The owner sent a 小红书 share link and asked for a similar post. The Herder answered
「这个链接我打不开，小红书分享帖需要登录才能看」 and asked for a screenshot, though the owner's
小红书 account had been connected and signed in for nine days. Only after 「我们不是有小红书mcp么」
did it start a task, which read the post at once. The owner: 「这里的逻辑很奇怪，他为什么不知道我没有
小红书mcp」 (he meant: why did it not know that we have it).

The Herder's log showed it called no tool on the first message. The system prompt said the
accounts are used "when session_list lists them as signed in", so whether an account existed only
showed up after a `session_list` call, and a message that looks like a quick question gets none.
Nothing said what to do with a 小红书 or 知乎 link.

## Decision

1. **A "Connected accounts" section at the end of the system prompt:** each turned-on 小红书 /
   知乎 account with "signed in" or "turned on, not signed in", and the connected apps; "None …
   connected in the app's 应用连接 page" when there are none. `session_list` still shows the same.
2. **Kept up to date:** before each turn the Herder compares the section with the accounts now;
   when one was connected, signed in or removed, the system prompt is rebuilt at once (otherwise
   only after 30 idle minutes, for memory). Connections change rarely, so the prompt cache holds.
3. **A rule for the links:** a 小红书 or 知乎 link (also a share link full of parameters, or one
   without https://) with that account signed in → start a read-only task with that platform's
   tools at once; never say it cannot be opened or ask for a screenshot. Not connected → say so in
   one line and that it is turned on in 应用连接, then work from what the owner says.

## Measured

`deepseek/deepseek-flash`, the owner's real share link with 「帮忙写个文案，我也要发一个类似的广告」,
3 runs each: account signed in → a task started on the first message 3 of 3 (before: 0 of 1, the
case above); nothing connected → no task, said it is not connected and where to connect 3 of 3
(one asked with buttons).

## Alternatives

- **Tell the Herder to call session_list first on every link.** One more tool call per message and
  it still forgets on messages it thinks are easy.
- **Let the Herder read 小红书 itself.** Reads would put whole posts and comments into its own
  context (ADR 0083); a task reads and reports.

## Tests

`packages/herder/test/accounts.test.ts`.
