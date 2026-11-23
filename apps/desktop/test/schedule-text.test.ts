import { describe, expect, it } from "vitest";
import { momentText, nextText, whenText } from "../src/renderer/src/schedule-text";

describe("whenText", () => {
  it("says when a schedule runs in Chinese", () => {
    expect(whenText({ kind: "daily", at: "09:00" })).toBe("每天 09:00");
    expect(whenText({ kind: "daily", at: "09:00", days: [1, 2, 3, 4, 5] })).toBe("工作日 09:00");
    expect(whenText({ kind: "daily", at: "09:00", days: [6, 7] })).toBe("周末 09:00");
    expect(whenText({ kind: "daily", at: "09:00", days: [1, 3] })).toBe("每周一、三 09:00");
    expect(whenText({ kind: "every", hours: 3 })).toBe("每 3 小时");
    expect(whenText({ kind: "once", at: "2026-11-12 09:00" })).toBe("2026-11-12 09:00 一次");
  });
});

describe("nextText", () => {
  const base = { paused: false };

  it("shows the next run in local time, or that it is paused", () => {
    const next = new Date(2026, 10, 11, 9, 0).toISOString();
    expect(momentText(next)).toBe("11月11日 09:00");
    expect(nextText({ ...base, nextAt: next })).toBe("下次：11月11日 09:00");
    expect(nextText({ ...base, paused: true })).toBe("已暂停");
    expect(nextText(base)).toBe("已结束");
  });
});
