// The pet's global shortcuts (ADR 0080): one opens the conversation to type, the other picks the
// oldest approval waiting and allows it on a second press. Pure, so main, the settings page and
// tests share it without Electron.

import { isPetShortcut, type PetCard, type PetView } from "@agentherd/host/api";

/** How long the second press of the approve shortcut may wait. */
export const ARM_MS = 5000;

/** An approval the approve shortcut can allow: one item, or one line of a combined card. */
export interface Approval {
  /** What `petPress(target, "allow")` answers. */
  target: string;
  title: string;
  task?: string;
  /** The card that shows it, to point at it in the pet. */
  ref: string;
}

/** The oldest approval still open in the pet's cards, if any. Questions are not approvals. */
export function topApproval(view: PetView | undefined): Approval | undefined {
  const open = (view?.cards ?? [])
    .filter((c) => c.open && c.view.kind === "item")
    .sort((a, b) => a.at.localeCompare(b.at));
  for (const card of open) {
    const found = approvalOf(card);
    if (found !== undefined) return found;
  }
  return undefined;
}

function approvalOf(card: PetCard): Approval | undefined {
  const v = card.view;
  if (v.kind !== "item" || v.final !== undefined) return undefined;
  if (v.lines === undefined) {
    if (!v.options.some((o) => o.action === "allow")) return undefined;
    return {
      target: v.itemId,
      title: v.title,
      ref: card.ref,
      ...(v.taskLabel === undefined ? {} : { task: v.taskLabel }),
    };
  }
  // A combined card: one line at a time, never 全部同意.
  const line = v.lines.find(
    (l) => l.final === undefined && l.options.some((o) => o.action === "allow"),
  );
  if (line === undefined) return undefined;
  return {
    target: line.itemId,
    title: line.title,
    ref: card.ref,
    ...(line.taskLabel === undefined ? {} : { task: line.taskLabel }),
  };
}

/** What a press of the approve shortcut does. */
export type ApprovePress =
  | { kind: "arm"; approval: Approval; until: number }
  | { kind: "allow"; approval: Approval }
  | { kind: "none" };

/**
 * The approve shortcut: the first press picks the oldest approval and arms it; a second press
 * within ARM_MS allows that same one. If another one became the oldest meanwhile, or the time is
 * up, the press arms again instead: it never allows something the owner was not shown.
 */
export class ApproveKey {
  private armed: { target: string; until: number } | undefined;

  press(view: PetView | undefined, now: number): ApprovePress {
    const approval = topApproval(view);
    if (approval === undefined) {
      this.armed = undefined;
      return { kind: "none" };
    }
    const armed = this.armed;
    if (armed !== undefined && armed.target === approval.target && now <= armed.until) {
      this.armed = undefined;
      return { kind: "allow", approval };
    }
    const until = now + ARM_MS;
    this.armed = { target: approval.target, until };
    return { kind: "arm", approval, until };
  }

  clear(): void {
    this.armed = undefined;
  }
}

/** What main tells the pet after the approve shortcut (shown above the input). */
export type PetArm =
  | { kind: "arm"; approval: Approval; until: number; key: string }
  | { kind: "none" }
  | { kind: "done"; approval: Approval }
  | { kind: "failed"; message: string };

/** Whether each shortcut works: taken means another app holds it. */
export type ShortcutState = Record<"talk" | "approve", "ok" | "taken" | "off">;

const MAC_SYMBOLS: Record<string, string> = {
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  CommandOrControl: "⌘",
  Super: "⌘",
};
const MAC_ORDER = ["Control", "Alt", "Shift", "CommandOrControl", "Super"];
const PC_NAMES: Record<string, string> = {
  CommandOrControl: "Ctrl",
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Super: "Win",
};
const PC_ORDER = ["CommandOrControl", "Control", "Super", "Alt", "Shift"];

/** A shortcut as the owner reads it: ⌘⇧Y on a Mac, Ctrl+Shift+Y elsewhere; "" stays "". */
export function shortcutLabel(accel: string, mac: boolean): string {
  if (accel === "") return "";
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const keyName = key === "Space" ? (mac ? "空格" : "Space") : key;
  if (mac) {
    const mods = [...parts].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return mods.map((m) => MAC_SYMBOLS[m] ?? m).join("") + keyName;
  }
  const mods = [...parts].sort((a, b) => PC_ORDER.indexOf(a) - PC_ORDER.indexOf(b));
  return [...mods.map((m) => PC_NAMES[m] ?? m), keyName].join("+");
}

const CODE_KEYS: Record<string, string> = {
  Space: "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Slash: "/",
  Period: ".",
  Comma: ",",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/** The keys a recorder sees in a keydown event. */
export interface KeyPress {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The shortcut a key press makes, or undefined while it is only modifiers or not one the pet
 * takes (a letter alone would type). Keys by their place (`code`), so the input method and
 * Shift do not change them.
 */
export function shortcutOf(e: KeyPress, mac: boolean): string | undefined {
  let key: string | undefined;
  const letter = /^Key([A-Z])$/.exec(e.code);
  const digit = /^Digit(\d)$/.exec(e.code);
  if (letter !== null) key = letter[1];
  else if (digit !== null) key = digit[1];
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
  else key = CODE_KEYS[e.code];
  if (key === undefined) return undefined;
  const mods: string[] = [];
  if (mac) {
    if (e.metaKey) mods.push("CommandOrControl");
    if (e.ctrlKey) mods.push("Control");
  } else {
    if (e.ctrlKey) mods.push("CommandOrControl");
    if (e.metaKey) mods.push("Super");
  }
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const accel = [...mods, key].join("+");
  return isPetShortcut(accel) ? accel : undefined;
}
