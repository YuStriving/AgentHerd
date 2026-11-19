import { describe, expect, it } from "vitest";
import {
  ANSWER_TEXT_MAX,
  cutInput,
  EVENT_TEXT_MAX,
  eventsPrompt,
  intakePrompt,
  ownerAnswerPrompt,
  VOICE_REPLY_MAX,
  voicePrompt,
} from "../src/prompt.ts";

describe("the Herder reads a bounded amount of each input (ADR 0083)", () => {
  it("keeps short text as it is and says how much a long one left out", () => {
    expect(cutInput("短", 10, "x")).toBe("短");
    expect(cutInput("abcdefghij12345", 10, "the card holds it")).toBe(
      "abcdefghij\n… (5 more characters left out; the card holds it)",
    );
  });

  it("cuts a long task reply, report, event, new-work item and answer", () => {
    const long = (n: number) => "字".repeat(n + 1000);
    const voice = voicePrompt({
      taskId: "e55ca076aaaa",
      title: "读日志",
      result: "done",
      reply: long(VOICE_REPLY_MAX),
      report: { state: "ready", summary: long(EVENT_TEXT_MAX) },
    } as Parameters<typeof voicePrompt>[0]);
    expect(voice).toContain("1000 more characters left out; the card holds the whole reply");
    expect(voice).toContain("1000 more characters left out; task_read shows more");
    expect(voice.length).toBeLessThan(VOICE_REPLY_MAX + EVENT_TEXT_MAX + 3000);
    const events = eventsPrompt([
      { kind: "github", taskId: "e55ca076aaaa", title: "修登录", text: long(EVENT_TEXT_MAX) },
    ]);
    expect(events.length).toBeLessThan(EVENT_TEXT_MAX + 400);
    expect(intakePrompt(long(EVENT_TEXT_MAX), false).length).toBeLessThan(EVENT_TEXT_MAX + 3000);
    const answer = ownerAnswerPrompt("选哪个？", long(ANSWER_TEXT_MAX));
    expect(answer).toContain("1000 more characters left out");
    expect(answer.length).toBeLessThan(ANSWER_TEXT_MAX + 300);
  });
});
