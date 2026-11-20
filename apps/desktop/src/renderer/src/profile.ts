// The owner's profile card in the app (ADR 0091): what each field is called on screen, and how an
// entry 「称呼：火哥」 splits into field and value.

import {
  type MemoryView,
  type OwnerProfile,
  PROFILE_FIELD_NAMES,
  type ProfileFieldName,
} from "@agentherd/host/api";

/** How the 记忆 page names each field, and what it shows while the field is empty. */
export const PROFILE_LABELS: Record<ProfileFieldName, { label: string; empty: string }> = {
  称呼: { label: "怎么叫你", empty: "还没定，主管就不叫名字" },
  身份: { label: "你是谁", empty: "还不知道" },
  在做: { label: "最近在做", empty: "还不知道" },
  作息: { label: "作息", empty: "还不知道" },
  回答方式: { label: "喜欢的回答", empty: "还不知道" },
  喜好: { label: "喜欢和不喜欢", empty: "还不知道" },
  在意: { label: "最近在意", empty: "还不知道" },
};

/** The field an entry is about, e.g. 「称呼」 for 「称呼：火哥」. */
export function profileFieldOf(abstract: string): ProfileFieldName | undefined {
  const m = /^\s*([^：:]{1,8})\s*[：:]\s*\S/.exec(abstract);
  const name = m?.[1]?.trim();
  return PROFILE_FIELD_NAMES.find((f) => f === name);
}

/** 「称呼：火哥」 → 「火哥」. */
export function profileValueOf(abstract: string): string {
  return abstract.slice(abstract.search(/[：:]/) + 1).trim();
}

type Entry = MemoryView["entries"][number];

/** One row of the card: the field, its entry when there is one. */
export interface ProfileRow {
  field: ProfileFieldName;
  value: string;
  entry?: Entry;
}

/** The card's rows in order: every field, filled from the active profile entries. */
export function profileRows(entries: readonly Entry[]): ProfileRow[] {
  return PROFILE_FIELD_NAMES.map((field) => {
    const entry = entries.find((e) => e.kind === "profile" && profileFieldOf(e.abstract) === field);
    return entry === undefined
      ? { field, value: "" }
      : { field, value: profileValueOf(entry.abstract), entry };
  });
}

/** The profile as the host reports it, from memory entries (for the browser preview). */
export function fakeProfile(view: MemoryView): OwnerProfile {
  const out: OwnerProfile = {};
  for (const row of profileRows(view.entries)) if (row.value !== "") out[row.field] = row.value;
  return out;
}
