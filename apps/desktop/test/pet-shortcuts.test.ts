import type { PetCard, PetView } from "@agentherd/host/api";
import { isPetShortcut } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";
import {
  ApproveKey,
  ARM_MS,
  type KeyPress,
  shortcutLabel,
  shortcutOf,
  topApproval,
} from "../src/shared/pet-shortcuts.ts";

const OPTIONS = [
  { action: "allow", label: "同意" },
  { action: "deny", label: "拒绝" },
  { action: "skip", label: "跳过" },
];

function item(ref: string, at: string, itemId: string, open = true): PetCard {
  return {
    ref,
    at,
    open,
    view: {
      kind: "item",
      itemId,
      taskLabel: "清理旧日志",
      title: `运行 ${itemId}`,
      body: "rm -rf ./logs/*",
      risk: "high",
      options: OPTIONS,
    },
  };
}

function combined(ref: string, at: string): PetCard {
  return {
    ref,
    at,
    open: true,
    view: {
      kind: "item",
      itemId: "card-1",
      title: "2 件事等你确认",
      body: "",
      risk: "high",
      options: [
        { action: "allow-all", label: "全部同意" },
        { action: "skip-all", label: "全部跳过" },
      ],
      lines: [
        {
          itemId: "line-1",
          n: 1,
          title: "删日志",
          body: "",
          risk: "high",
          options: [],
          final: "你已同意",
        },
        {
          itemId: "line-2",
          n: 2,
          title: "删缓存",
          body: "",
          risk: "high",
          options: OPTIONS.slice(0, 2),
        },
      ],
    },
  };
}

function ask(ref: string, at: string): PetCard {
  return {
    ref,
    at,
    open: true,
    view: {
      kind: "ask",
      askId: "ask-1",
      text: "用哪个仓库？",
      options: [{ action: "0", label: "A" }],
    },
  };
}

function view(cards: PetCard[]): PetView {
  return { connected: true, pending: [], history: [], cards };
}

function key(code: string, mods: Partial<KeyPress> = {}): KeyPress {
  return { code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

describe("the approve shortcut (ADR 0080)", () => {
  it("picks the oldest open approval, a combined card's first open line, never a question", () => {
    const cards = [
      item("c3", "2026-11-19T03:00:00.000Z", "newer"),
      ask("c1", "2026-11-19T01:00:00.000Z"),
      item("c0", "2026-11-19T00:30:00.000Z", "closed", false),
      item("c2", "2026-11-19T02:00:00.000Z", "older"),
    ];
    expect(topApproval(view(cards))).toEqual({
      target: "older",
      title: "运行 older",
      task: "清理旧日志",
      ref: "c2",
    });
    expect(topApproval(view([combined("m1", "2026-11-19T01:00:00.000Z")]))).toEqual({
      target: "line-2",
      title: "删缓存",
      ref: "m1",
    });
    expect(topApproval(view([ask("c1", "2026-11-19T01:00:00.000Z")]))).toBeUndefined();
    expect(topApproval(undefined)).toBeUndefined();
  });

  it("allows only on a second press of the same one within five seconds", () => {
    const keyPress = new ApproveKey();
    const one = view([item("c1", "2026-11-19T01:00:00.000Z", "one")]);
    expect(keyPress.press(one, 0)).toMatchObject({ kind: "arm", until: ARM_MS });
    expect(keyPress.press(one, ARM_MS)).toMatchObject({
      kind: "allow",
      approval: { target: "one" },
    });
    // Allowed: the next press arms again.
    expect(keyPress.press(one, ARM_MS + 1)).toMatchObject({ kind: "arm" });
    // Too late: arms again instead of allowing.
    expect(keyPress.press(one, 3 * ARM_MS)).toMatchObject({ kind: "arm" });
    // Another one became the oldest meanwhile: the owner is shown it first.
    const other = view([item("c0", "2026-11-19T00:00:00.000Z", "zero"), ...one.cards]);
    expect(keyPress.press(other, 3 * ARM_MS + 10)).toMatchObject({
      kind: "arm",
      approval: { target: "zero" },
    });
    keyPress.clear();
    expect(keyPress.press(other, 3 * ARM_MS + 20)).toMatchObject({ kind: "arm" });
    expect(keyPress.press(view([]), 3 * ARM_MS + 30)).toEqual({ kind: "none" });
  });
});

describe("shortcut keys (ADR 0080)", () => {
  it("takes only combinations that do not type", () => {
    expect(isPetShortcut("CommandOrControl+Shift+Y")).toBe(true);
    expect(isPetShortcut("CommandOrControl+Shift+Space")).toBe(true);
    expect(isPetShortcut("F9")).toBe(true);
    expect(isPetShortcut("Y")).toBe(false);
    expect(isPetShortcut("Shift+Y")).toBe(false);
    expect(isPetShortcut("CommandOrControl+Shift+Alt+Control+Y")).toBe(false);
    expect(isPetShortcut("CommandOrControl+Shift")).toBe(false);
    expect(isPetShortcut("")).toBe(false);
  });

  it("records a press by where the key is, the Mac's Command as CommandOrControl", () => {
    expect(shortcutOf(key("KeyY", { metaKey: true, shiftKey: true }), true)).toBe(
      "CommandOrControl+Shift+Y",
    );
    expect(shortcutOf(key("Space", { ctrlKey: true, altKey: true }), true)).toBe(
      "Control+Alt+Space",
    );
    expect(shortcutOf(key("KeyY", { ctrlKey: true, shiftKey: true }), false)).toBe(
      "CommandOrControl+Shift+Y",
    );
    expect(shortcutOf(key("Digit1", { metaKey: true }), false)).toBe("Super+1");
    expect(shortcutOf(key("F9"), true)).toBe("F9");
    expect(shortcutOf(key("KeyY", { shiftKey: true }), true)).toBeUndefined();
    expect(shortcutOf(key("ShiftLeft", { shiftKey: true }), true)).toBeUndefined();
  });

  it("shows a shortcut the way each system writes it", () => {
    expect(shortcutLabel("CommandOrControl+Shift+Y", true)).toBe("⇧⌘Y");
    expect(shortcutLabel("CommandOrControl+Shift+Space", true)).toBe("⇧⌘空格");
    expect(shortcutLabel("CommandOrControl+Shift+Y", false)).toBe("Ctrl+Shift+Y");
    expect(shortcutLabel("Control+Alt+Space", false)).toBe("Ctrl+Alt+Space");
    expect(shortcutLabel("", true)).toBe("");
  });
});
