# ADR 0086: A research search asks several sources at once

- Status: Accepted
- Date: 2026-11-19
- Changes: [0071](0071-look-things-up-and-keep-the-board-short.md) (web_search),
  [0085](0085-asked-for-projects-the-herder-names-real-ones.md) (asked for projects)

## Context

- The Herder searched one source per call: the web (DuckDuckGo, then Bing) or GitHub. For
  research questions it found little and answered from too few pages. Owner (2026-11-19):
  「现在是来源有点少？」「不一定非要特别快」.
- The owner set the rule: 「如果是个事件问题，比如问你的股价，只搜一个bing就够了，如果是类似调研，就都搜，
  不过要你测试一下速度」. arXiv, GitHub issues, 小红书 and 知乎 were left out (「arxiv不要加了」;
  issue search 「很奇怪」; 小红书/知乎 need the owner's accounts).
- Measured on this computer (2 rounds × 4 questions): DuckDuckGo 1.0–1.3 s, Bing 0.6–8.5 s,
  GitHub 0.7–1.4 s, Hacker News (Algolia) 0.8–2.3 s; all three at once 1.8–4.9 s, once 11.6 s
  because of Bing. cn.bing.com gave nothing. Reading a page takes about 2 s, three at once too.
- Others: Codex and Claude Code give the model one search tool and let it search again; OpenClaw
  chains providers with fallback and has a deep-research extension with budgets; Hermes'
  web-search-plus has a research mode that asks several providers, merges and dedupes, and stops
  waiting once two of them gave results (quorum). Perplexity separates Quick from Pro.

## Decision

1. `web_search` gets `source: "research"`: the web, GitHub repositories and Hacker News stories
   at once. For research the web asks DuckDuckGo and Bing at the same time and takes the first
   with results (one of them often turns a burst away or takes seconds).
2. It waits for the web and one more source with results, or for all three, and never more than
   8 s (`RESEARCH_WAIT_MS`). A source still running then is left out and the result says so
   (`GitHub too slow, left out`); a failed one says `failed`. Only when every source failed is it
   an error.
3. One list: the same page from several sources (`sameLink`: no scheme, `www`, trailing slash,
   tracking parameters; GitHub paths in any case) is listed once with all its sources, and pages
   more sources found come first. Each line is tagged `[web, GitHub, Hacker News]`; GitHub lines
   carry stars, forks, language and last push, Hacker News lines points, comments, date and the
   discussion link. Up to 12 results by default (20 at most). The first line says how long it
   took and what each source gave.
4. The Herder picks: a fact, a price, a date or what happened → one plain web search; projects,
   tools, comparisons, how people do something or what they think of it → `research`, then
   `web_read` on the two or three results that matter, in parallel, before answering. Asked for
   projects it searches with `research` (ADR 0085's rules otherwise stay).
5. Plain `web` and `github` searches are unchanged.

## Alternatives

- **Search providers with keys (Exa, Tavily, Brave)**: better results, but each needs an account
  and a key from the owner; the free sources were enough for a first step.
- **The model searching each source itself**: three tool calls and three model steps where one
  call does it in seconds.
- **Waiting for every source**: one slow engine (Bing at 8–20 s) would hold every research
  search; the quorum keeps it near the fastest two.
- **arXiv, GitHub issues, cn.bing.com**: left out (see Context).

## Consequences

- A research turn is a search of 1–8 s, reading 2–3 pages in about 2 s, and the model's own
  steps: about 15–30 s, without a task.
- Hacker News rarely has Chinese results and GitHub only technical ones; the web carries the
  rest. When DuckDuckGo turns searches away and Bing is slow, the web may be left out of a
  research result; the Herder then has GitHub and Hacker News and can search the web again.

## Tests

- `packages/herder/test/lookup.test.ts` describe "research search (ADR 0086)": same-link rules,
  merge order and sources, all three sources merged with their facts, a slow source left out
  once two have results, the time limit and all-failed error, the prompt and tool description.
