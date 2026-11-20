import type { MemoryView } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";
import { profileFieldOf, profileRows, profileValueOf } from "../src/renderer/src/profile";

type Entry = MemoryView["entries"][number];

function entry(kind: Entry["kind"], abstract: string): Entry {
  return {
    id: abstract,
    kind,
    scope: "global",
    abstract,
    body: "",
    source: "review",
    status: "active",
    accessCount: 0,
    rev: 1,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
  };
}

describe("the profile card on the 记忆 page (ADR 0091)", () => {
  it("splits an entry into field and value", () => {
    expect(profileFieldOf("称呼：火哥")).toBe("称呼");
    expect(profileFieldOf("回答方式: 先说结论")).toBe("回答方式");
    expect(profileFieldOf("报告用中文")).toBeUndefined();
    expect(profileValueOf("在做：AgentHerd 的桌宠")).toBe("AgentHerd 的桌宠");
  });

  it("shows every field in order, filled from profile entries only", () => {
    const rows = profileRows([
      entry("profile", "在做：AgentHerd"),
      entry("owner", "称呼：别用这个"),
      entry("profile", "称呼：火哥"),
    ]);
    expect(rows.map((r) => r.field)).toEqual([
      "称呼",
      "身份",
      "在做",
      "作息",
      "回答方式",
      "喜好",
      "在意",
    ]);
    expect(rows[0]?.value).toBe("火哥");
    expect(rows[1]).toEqual({ field: "身份", value: "" });
    expect(rows[2]?.entry?.abstract).toBe("在做：AgentHerd");
  });
});
