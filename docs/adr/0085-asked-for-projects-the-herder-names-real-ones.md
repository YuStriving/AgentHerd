# ADR 0085: Asked for projects, the Herder names real ones; a file goes to a task at once

- Status: Accepted
- Date: 2026-11-19
- Changes: [0071](0071-look-things-up-and-keep-the-board-short.md) (GitHub search),
  [0082](0082-task-dots-and-files-dropped-on-the-pet.md) (dropped files)

## Context

- The owner asked 「long-horizon agent runtime 这个词是啥意思，有没有类似的项目」 and got a long
  explanation with the projects as a short list at the end, then 「要我细读哪一个？」. Owner
  (2026-11-19): 「我们的模型喜欢解释，但不喜欢去找具体的项目」.
- The log showed why: every `web_search` with `source: github` that day answered 「nothing found」
  — 5 of 5. The Herder wrote sentences (「long running agent runtime open source project 2026」,
  「maimai mcp server model context protocol」), and GitHub's repository search needs every word to
  match the name, description or topics. 「maimai mcp」 alone finds 33 repositories; the Herder's
  three tries for 脉脉 found none and it told the owner there was nothing.
- Files: the Herder sees a dropped or sent file only as a path ([0082](0082-task-dots-and-files-dropped-on-the-pet.md),
  [0083](0083-the-herder-reads-bounded-input.md)) and asked 「要我叫个小任务读一下吗？」 before
  doing anything. Owner: 「让主管直接开个小任务去读」.

## Decision

1. **GitHub search narrows itself.** When the words as given find nothing, the search tries them
   without Chinese words, then the first three, then the first two, and says so: 「No repository
   matched every word of "…"; these match "…":」. The tool's description asks for two or three key
   words in English.
2. **Projects first.** When the owner asks for projects, tools or repositories, the Herder searches
   GitHub as well as the web, tries other words before saying there is none, looks at the ones worth
   naming with `web_read`, and lists them first — link, stars, last push, one line on what each
   does — with at most two sentences of explanation before them. Only projects it saw in a result.
   When more is wanted than a few searches give, it starts a task instead of offering to.
3. **A file goes to a task at once.** When the owner wants anything from the content of a file they
   sent or dropped, the Herder starts a small task with the path, without asking first. Pictures it
   still sees itself.

## Alternatives

- **Sort GitHub results by stars.** Best match already ranks the name hits first; stars would bury
  a small exact match such as a two-week-old MCP server.
- **Let the Herder read small text files itself.** The owner rejected filling its conversation with
  file contents (ADR 0083).

## Consequences

- A GitHub search can take up to four requests; with the owner's GitHub sign-in the limit is 30 a
  minute.
- Measured with deepseek-flash and the real network: 「有没有类似的项目」 three runs, each listed
  real repositories from GitHub with stars and last push (loopx, cayu, AxisAgentic,
  hankweave-runtime, ArgusAgent…); 「脉脉有mcp么」 two runs, both found
  JACKWang19559/maimai-mcp; a dropped file and a Feishu file each started a task in the first step.

## Tests

- `packages/herder/test/lookup.test.ts`: the narrower queries; a search found only with fewer words
  says so; a search with nothing tries once per distinct query; the prompt and tool description
  carry the rules.
