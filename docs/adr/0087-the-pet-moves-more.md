# 0087. The pet moves more

- Status: Accepted
- Date: 2026-11-20
- Changes: [0070](0070-a-desktop-pet.md)

## Context

The pet played one clip per mood (ADR 0070): breathing and blinking while calm, one row each for
working, waiting, done, failed, a still frame asleep, and a wave on click. Most of the time it
showed the same calm loop, and nothing showed that the Herder was busy with the owner's message.
The owner: 「我希望我们这里的pet的动作丰富一些？」 and 「主管在想的时候应该有个动作？」. The
llm-pet sheets the figures come from have three rows we did not use: running right, running left
and review (reading).

## Decision

1. **Three more rows in each atlas,** cut from the same llm-pet sheets: review (6 frames), running
   right and running left (8 each). The first seven rows are unchanged. No new art.
2. **Thinking.** From the moment the owner sends a message until the Herder's reply is in the
   conversation, the pet plays the review row (reading) and a small 「…」 bubble with three
   bouncing dots shows by its head. The 「…」 is drawn in CSS, because the DeepSeek figure's review
   row barely moves. A message counts at most 3 minutes, so a lost reply does not keep it reading.
   It also shows for a message sent from Feishu.
3. **A jump when the reply comes,** once, before the calm loop goes on.
4. **Walking while dragged:** the row for the way the owner drags it, kept while it moves up or
   down; it stops on release.
5. **Small moves when calm:** every 20 to 40 seconds a calm pet waves, jumps or reads for a moment,
   never the same move twice in a row. Only while calm: working, waiting, sleeping or a reply in
   progress have their own clip.
6. **A wave when the pointer comes onto it,** at most once every 10 seconds.
7. **What plays, strongest first:** walking, the wave, the jump, waiting / done / failed, thinking,
   a small move, then the mood. Thinking also wakes a sleeping pet.
8. **No walking on its own.** The pet does not stroll along the screen edge when idle: the owner
   decided against it (it would move a window by itself).

With 「减少动态效果」 turned on in the system, the figure shows the first frame of a clip and the
dots do not bounce, as before.

## Alternatives

- **Ask the host whether the Herder is busy.** It would also cover a turn the owner did not start
  (a scheduled job), but needs a new event; the conversation already says when the owner's
  message has no reply yet.
- **Walk along the screen edge when idle.** Most like a living pet; dropped by the owner.
- **New drawings for thinking.** The review row and a CSS bubble say it without new art.

## Consequences

- Each atlas is 10 rows instead of 7: about 0.8 MB instead of 0.5 MB.
- The jump replays the done row once, so a reply and a finished task look alike for a moment.

## Tests

`apps/desktop/test/pet-state.test.ts` ("more moves (ADR 0087)", "pet frames").
