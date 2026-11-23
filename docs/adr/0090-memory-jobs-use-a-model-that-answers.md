# 0090. Memory jobs use a model that answers, and reviews catch up

- Status: Accepted; changed by [0101](0101-memory-comes-with-each-turn.md) (reviews by tokens, 80 lines or 24,000 characters at a time)
- Date: 2026-11-20
- Changes: [0038](0038-herder-memory.md) (which model memory jobs use, how reviews read)

## Context

The owner: 「我感觉我们的记忆不太生效」. On 2026-11-20 the owner's memory held two entries: one
lesson from 2026-11-09 and one note from that day. Nothing about the owner, people or projects.

Memory jobs run on "the first model of the fast tier a service with a key offers, else the
Herder's model" (ADR 0038). On this computer that was `site/gpt-6-luna`, which answered every
request with `Request timed out.` after about 10 s, while `deepseek/deepseek-flash` answered the
same request in 4 s. Since 2026-11-09 all 16 reviews and 3 lessons failed after their retries.
The choice never moved past the first model, because it only checked that the service had a key.

A review read the newest 40 lines and skipped those before the last finished review. So the 256
lines (103 from the owner) said while reviews failed could never be read: by the next working
review they were no longer among the newest 40.

## Decision

1. **Memory jobs try the models in turn.** The fast tier's models a service with a key offers,
   in order, then the Herder's own model, each once. A model that fails or takes over 60 s is
   passed over for 10 minutes and the next one is tried; when all are passed over, all are tried.
   One job may take 180 s over its tries (was 90 s for one). The host log says which model failed
   and why.
2. **Reviews read in order.** A review reads at most 40 lines after the last finished review,
   oldest first, whatever line its job was queued after. When it read a full 40, it queues the
   next review at once.
3. **Catch up at start.** When the worker starts and no review is waiting, it queues one if the
   owner said something no review has read.

## Alternatives

- **Run memory jobs on the Herder's model only.** Simple and it works here, but the Herder's
  model is often the dearest one; the fast tier exists for this work.
- **Test each model when the owner saves the tiers.** Catches a dead model early, but a model can
  stop answering later; falling through covers both.
- **Re-run the failed jobs.** They point at the newest lines of their time, not at what was missed.

## Consequences

- Catching up reads about 7 chunks of 40 lines on this computer, one model request each.
- A model that works but is slow is passed over after 60 s, so a long review on a slow model is
  cut and done on the next.

## Tests

`packages/herder/test/memory-jobs.test.ts` ("reviews catch up"), `packages/herder/test/models.test.ts`
("memory models fall back").
