# 0097. The owner picks the Herder's working window

- Status: Accepted
- Date: 2026-11-21
- Changes: [0045](0045-herder-context-folded-by-the-model.md) (the window was fixed at 128,000 tokens), [0096](0096-the-context-tab-reads-herd-db-and-shows-the-folds-as-a-tree.md) (the 上下文 tab shows and sets it)

## Context

ADR 0045 lets the Herder work in the model's window, but at most 128,000 tokens: every request sends
the whole view, and a chat with the owner seldom needs more. The 上下文 tab showed
「≈80k / 128k」. The owner's model, DeepSeek flash, takes 1,000,000 tokens, so the owner asked
「我们现在上限为什么是128k，怪怪的」 and then 「其实我没听懂，实际上是1M，但是提醒的比较早」.
That is right: the model takes 1M, and the Herder starts folding at 90 % of 128K. Nothing on the
page said so, and nothing let the owner change it. Asked whether to only say it or also make it a
setting, the owner said 「pr吧」 to the proposal that did both.

Measured on the owner's `herd.db`: 297 requests, the largest about 98K tokens, on average about 49K.

## Decision

1. **A setting with four choices.** `herderWindow` in `config.json`: 64K, 128K (the default), 256K
   or 0 for the model's whole window. The working window is the choice, never more than the
   model's own (`workingWindow(model, choice)`; a model that does not say gets the choice, or 128K
   for "the model's whole window"). Nudges, the 90 % fold and the overflow retry all follow it.
2. **Read on every request.** The Herder reads the choice through `contextCap` each time it builds
   a request, so a change takes effect on the next reply without a restart; no fold is undone.
3. **On the 上下文 tab.** Under the bar: 「主管的工作窗口 · 128k（模型最多 1M）」, one line on what it
   does (folds at 90 %; bigger keeps more original text, but each reply is slower and dearer; never
   above the model's limit) and a four-way switch 64k / 128k / 256k / 用满模型. The map says
   「工作窗口 128k」. The host rebuilds the view with the owner's choice and the model's window, and
   both are in the view's key, so a change shows at once.
4. **Validation.** `updateSettings({herderWindow})` refuses anything else with
   "herderWindow must be one of 64000, 128000, 256000, 0"; an unknown value in `config.json` reads
   as 128K.

## Alternatives

- **Only explain the number.** Clearer, but the owner still could not use the model's room.
- **A free number field.** More choices than anyone needs, and easy to set above the model or so low
  that every turn folds.
- **The model's window as the default.** At 1M, every request could send several hundred thousand
  tokens before anything folds: slower replies and more cost for a chat that rarely needs it.
  ADR 0045 measured nudges at ~450K and the forced fold at ~900K with that window.

## Consequences

- Picking 256K or the whole window keeps more of the conversation verbatim; requests grow, so
  replies get slower and cost more, though cache hits soften it (the owner's hit rate is ~93 %).
- Picking a smaller window than the current context folds on the next request (the 90 % rule), not
  at the moment of the click.
- The setting lives on the 上下文 tab only, next to the bar it changes; 设置 does not show it.

## Tests

- `packages/herder/test/context.test.ts` "the working window (ADR 0097)": the choice never exceeds the
  model, the defaults, and the fold line follows a choice read on every request.
- `packages/host/test/herder-context-view.test.ts`: the view's window, fold line, choice and model
  window for 128K, 256K and the whole window.
- `packages/host/test/host.test.ts`: status, saving to `config.json` and refusing other values.
- `apps/desktop/test/herder-context.test.ts`: the window line and the four choices.
