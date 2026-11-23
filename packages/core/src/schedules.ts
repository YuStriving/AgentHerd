// What the Herder does at set times (ADR 0055). Since ADR 0100 a schedule is a mailbox source of
// kind `timer`; this file knows when one runs. At the time the saved words come back to the Herder
// as a turn of their own, which may answer, start a task or say nothing. Only an owner's message
// can make or change one: nothing a task, a web page or a mail says can give the Herder work at
// set times.

/** The shortest and longest gap of an "every" schedule. */
export const EVERY_HOURS_MIN = 1;
export const EVERY_HOURS_MAX = 24 * 7;

/** When a schedule runs, in the Mac's local time. Days are 1 (Monday) to 7 (Sunday). */
export type ScheduleWhen =
  | { kind: "daily"; at: string; days?: number[] }
  | { kind: "every"; hours: number }
  | { kind: "once"; at: string };

export interface Schedule {
  id: string;
  /** A short name in the owner's words, e.g. 「早上看 PI-Desktop 新 issue」. */
  about: string;
  /** What the Herder does at the time, as the owner asked it. */
  prompt: string;
  when: ScheduleWhen;
  paused: boolean;
  createdAt: string;
  /** Next run (ISO); missing for a paused schedule. */
  nextAt?: string;
  lastAt?: string;
}

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})[ T]([01]?\d|2[0-3]):([0-5]\d)$/;

/** Throws when `when` cannot be run; returns it tidied. */
export function checkWhen(when: ScheduleWhen): ScheduleWhen {
  if (when.kind === "daily") {
    if (!CLOCK.test(when.at)) throw new Error(`at must be HH:MM, not "${when.at}"`);
    const days = when.days === undefined ? [] : [...new Set(when.days)].sort((a, b) => a - b);
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      throw new Error("days are 1 (Monday) to 7 (Sunday)");
    }
    const at = when.at.padStart(5, "0");
    return days.length === 0 || days.length === 7
      ? { kind: "daily", at }
      : { kind: "daily", at, days };
  }
  if (when.kind === "every") {
    const h = when.hours;
    if (!Number.isFinite(h) || h < EVERY_HOURS_MIN || h > EVERY_HOURS_MAX) {
      throw new Error(`hours must be ${EVERY_HOURS_MIN} to ${EVERY_HOURS_MAX}`);
    }
    return { kind: "every", hours: h };
  }
  if (when.kind === "once") {
    if (localMoment(when.at) === undefined) {
      throw new Error(`at must be "YYYY-MM-DD HH:MM", not "${when.at}"`);
    }
    return { kind: "once", at: when.at.replace("T", " ") };
  }
  throw new Error('when.kind must be "daily", "every" or "once"');
}

function localMoment(text: string): Date | undefined {
  const m = MOMENT.exec(text.trim());
  if (m === null) return undefined;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : undefined;
}

/** 1 (Monday) to 7 (Sunday). */
function isoDay(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/** The first run strictly after `after`; undefined when there is none (a past "once"). */
export function nextRun(when: ScheduleWhen, after: Date): Date | undefined {
  if (when.kind === "every") return new Date(after.getTime() + when.hours * 3_600_000);
  if (when.kind === "once") {
    const at = localMoment(when.at);
    return at !== undefined && at > after ? at : undefined;
  }
  const [h, m] = when.at.split(":").map(Number) as [number, number];
  for (let i = 0; i <= 7; i++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i, h, m);
    if (day <= after) continue;
    if (when.days === undefined || when.days.includes(isoDay(day))) return day;
  }
  return undefined;
}

/** The time of a schedule in English, for the Herder (it tells the owner in their language). */
export function describeWhen(when: ScheduleWhen): string {
  if (when.kind === "every") return `every ${when.hours} hour${when.hours === 1 ? "" : "s"}`;
  if (when.kind === "once") return `once at ${when.at}`;
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days =
    when.days === undefined ? "every day" : when.days.map((d) => names[d - 1]).join(", ");
  return `${days} at ${when.at}`;
}
