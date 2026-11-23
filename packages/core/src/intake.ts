// GitHub work waiting for the owner (ADR 0052): issues assigned to them and pull requests waiting
// for their review, found with `gh search`. Since ADR 0100 a mailbox source of kind `work` does
// the looking; this file only knows how to search and how to say an item in one line.
import type { GhRun } from "./github-watch.ts";

/** Items read per search. */
const SEARCH_MAX = 30;
const TITLE_MAX = 120;

export type IntakeKind = "issues" | "reviews";

/** What a search looks for: assigned issues or review requests, maybe in one repo or label. */
export interface IntakeSearch {
  kind: IntakeKind;
  /** `owner/name`; every repository when missing. */
  repo?: string;
  label?: string;
}

/** One issue or pull request as a search found it. */
export interface IntakeItem {
  kind: IntakeKind;
  repo: string;
  number: number;
  title: string;
  url: string;
}

function tidy(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** The `gh search` arguments: open items assigned to, or waiting on, the owner. */
export function searchArgs(search: IntakeSearch): string[] {
  const args =
    search.kind === "issues"
      ? ["search", "issues", "--assignee=@me"]
      : ["search", "prs", "--review-requested=@me"];
  args.push("--state=open");
  if (search.repo !== undefined) args.push("--repo", search.repo);
  if (search.label !== undefined) args.push("--label", search.label);
  args.push("--json", "number,title,url,repository", "--limit", String(SEARCH_MAX));
  return args;
}

/** Runs a search; `gh` answers a JSON list. */
export async function searchItems(run: GhRun, search: IntakeSearch): Promise<IntakeItem[]> {
  const out = await run(searchArgs(search));
  let list: unknown;
  try {
    list = JSON.parse(out === "" ? "[]" : out);
  } catch {
    throw new Error(`unexpected gh answer: ${tidy(out, 200)}`);
  }
  if (!Array.isArray(list)) throw new Error(`unexpected gh answer: ${tidy(out, 200)}`);
  return list
    .map(
      (x) =>
        x as {
          number?: number;
          title?: string;
          url?: string;
          repository?: { nameWithOwner?: string };
        },
    )
    .filter((x) => typeof x.url === "string" && typeof x.number === "number")
    .map((x) => ({
      kind: search.kind,
      repo: x.repository?.nameWithOwner ?? "",
      number: x.number as number,
      title: tidy(x.title ?? "", TITLE_MAX) || "(no title)",
      url: x.url as string,
    }));
}

/** One line about an item, for the Herder. */
export function itemLine(item: IntakeItem): string {
  const what = item.kind === "issues" ? "issue" : "pull request to review";
  return `${what} ${item.repo}#${item.number}: ${item.title} ${item.url}`;
}
