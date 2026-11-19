// The desktop pet's moving pictures (ADR 0070). Each figure is one atlas of 192×208 cells, cut
// from the llm-pet sprite sheets (Codex pet layout): one row per clip, played with the frame
// times of the Codex pet format. Pure functions, so they are easy to test.

import { MOODS, type Mood } from "./pet-state";

export const CELL = { width: 192, height: 208 } as const;
/** MOODS, then hello, thinking, walking right and walking left. */
export const ATLAS = { columns: 8, rows: MOODS.length + 4 } as const;

/**
 * The moods, plus moves that are not moods: a wave (clicked, pointed at, or idle), a jump (a
 * reply came, or idle), reading while the Herder thinks, and walking while dragged (ADR 0087).
 */
export type Clip = Mood | "hello" | "jump" | "thinking" | "walkRight" | "walkLeft";

export interface Animation {
  /** Row in the atlas. */
  row: number;
  /** How long each frame shows, in ms. */
  durations: readonly number[];
  /** Plays again and again; otherwise it stops on its last frame. */
  loop: boolean;
  /** Holds the first frame this long before each round, so a calm pet is not busy. */
  rest?: number;
}

const each = (ms: number, count: number, last: number): number[] => [
  ...Array.from({ length: count - 1 }, () => ms),
  last,
];

/** Rows follow MOODS, then the extra moves. Frame times are the Codex pet ones for the matching row. */
export const ANIMATIONS: Record<Clip, Animation> = {
  // Codex idle: breathing and blinking
  resting: { row: 0, durations: [280, 110, 110, 140, 140, 320], loop: true, rest: 2_400 },
  // Codex running (busy with a task)
  working: { row: 1, durations: each(120, 6, 220), loop: true },
  // Codex waiting (asks for approval)
  waiting: { row: 2, durations: each(150, 6, 260), loop: true },
  // Codex jumping
  celebrate: { row: 3, durations: each(140, 5, 280), loop: true },
  // Codex failed: once, then stays down
  error: { row: 4, durations: each(140, 8, 240), loop: false },
  // one still frame; the slow breathing is CSS
  sleeping: { row: 5, durations: [1_000], loop: false },
  // Codex waving
  hello: { row: 6, durations: each(140, 4, 280), loop: true },
  // Codex jumping, once
  jump: { row: 3, durations: each(140, 5, 280), loop: false },
  // Codex review: reading while the Herder thinks
  thinking: { row: 7, durations: each(150, 6, 300), loop: true },
  // Codex running right / left
  walkRight: { row: 8, durations: each(120, 8, 120), loop: true },
  walkLeft: { row: 9, durations: each(120, 8, 120), loop: true },
};

const lengthOf = (a: Animation): number => a.durations.reduce((x, y) => x + y, 0);

/** One wave of hello. */
export const HELLO_MS = lengthOf(ANIMATIONS.hello);
/** One jump. */
export const JUMP_MS = lengthOf(ANIMATIONS.jump);

/** A message the owner sent counts as being thought about for at most this long. */
export const THINK_MAX_MS = 3 * 60_000;

/**
 * The Herder is working on a reply: the owner's message is not recorded yet, or the newest line
 * of the conversation is the owner's and still recent.
 */
export function thinkingOf(
  history: readonly { kind: string; at: string }[],
  sending: number,
  now: number,
): boolean {
  if (sending > 0) return true;
  const last = history[history.length - 1];
  return last?.kind === "owner" && now - Date.parse(last.at) < THINK_MAX_MS;
}

/** The small moves an idle pet makes now and then, never the same twice in a row. */
export const FIDGETS = ["hello", "jump", "thinking"] as const satisfies readonly Clip[];
export type Fidget = (typeof FIDGETS)[number];
export const FIDGET_EVERY_MS = { min: 20_000, max: 40_000 } as const;
/** How long a fidget plays: one wave, one jump, a short read. */
export const FIDGET_MS: Record<Fidget, number> = {
  hello: 2 * HELLO_MS,
  jump: JUMP_MS,
  thinking: 2 * lengthOf(ANIMATIONS.thinking),
};

/** The next fidget, given the last one and a number in [0, 1). */
export function nextFidget(last: Fidget | undefined, r: number): Fidget {
  const choices = FIDGETS.filter((f) => f !== last);
  return choices[Math.min(choices.length - 1, Math.floor(r * choices.length))] ?? "hello";
}

/** Time until the next fidget, for a number in [0, 1). */
export function fidgetDelay(r: number): number {
  return FIDGET_EVERY_MS.min + Math.floor(r * (FIDGET_EVERY_MS.max - FIDGET_EVERY_MS.min));
}

/** Which way a dragged pet walks: the way it was last moved sideways, kept while it moves up or down. */
export function walkOf(
  last: "walkRight" | "walkLeft" | undefined,
  dx: number,
): "walkRight" | "walkLeft" | undefined {
  if (dx > 1) return "walkRight";
  if (dx < -1) return "walkLeft";
  return last;
}

/** What the figure plays, strongest first. */
export function clipOf(i: {
  mood: Mood;
  walk?: "walkRight" | "walkLeft" | undefined;
  hello?: boolean;
  jump?: boolean;
  thinking?: boolean;
  fidget?: Fidget | undefined;
}): Clip {
  if (i.walk !== undefined) return i.walk;
  if (i.hello === true) return "hello";
  if (i.jump === true) return "jump";
  // Asking for approval, cheering a finished task or a failure say more than thinking does.
  if (i.mood === "waiting" || i.mood === "celebrate" || i.mood === "error") return i.mood;
  if (i.thinking === true) return "thinking";
  if (i.mood === "resting" && i.fidget !== undefined) return i.fidget;
  return i.mood;
}

/** The frame to show `elapsed` ms after a clip started, and how long until the next one. */
export function frameAt(a: Animation, elapsed: number): { column: number; next: number } {
  const last = a.durations.length - 1;
  if (last <= 0) return { column: 0, next: Number.POSITIVE_INFINITY };
  const rest = a.rest ?? 0;
  const round = rest + a.durations.reduce((x, y) => x + y, 0);
  let t = Math.max(0, elapsed);
  if (!a.loop && t >= round) return { column: last, next: Number.POSITIVE_INFINITY };
  t %= round;
  if (t < rest) return { column: 0, next: rest - t };
  t -= rest;
  for (const [column, ms] of a.durations.entries()) {
    if (t < ms) return { column, next: ms - t };
    t -= ms;
  }
  return { column: last, next: 1 };
}
