// The pull requests tasks opened that AgentHerd keeps an eye on (ADR 0058). Everything else the
// owner asked to hear about — mail, GitHub work, 小红书/知乎 notices, timers — is a mailbox source
// (ADR 0100). Pausing keeps a watch but stops looking.

import { GITHUB_POLL_MINUTES, type Herd, prKey } from "@agentherd/core";
import type { WatchView } from "./api.ts";

export function watchViews(herd: Herd): WatchView[] {
  const { store } = herd;
  const out: WatchView[] = [];
  for (const w of store.prWatches()) {
    const title = store.task(w.taskId)?.task.title;
    out.push({
      id: `pr:${prKey(w)}`,
      kind: "pr",
      title: `${w.repo.split("/")[1] ?? w.repo} #${w.number}${title ? ` ${title}` : ""}`,
      detail: `${w.closed === undefined ? "CI、评审和合并" : w.closed === "merged" ? "已合并，还看评论" : "已关闭，还看评论"}，每 ${GITHUB_POLL_MINUTES} 分钟看一次`,
      paused: w.paused === true,
      removable: true,
      createdAt: w.createdAt,
      activeAt: w.activeAt,
    });
  }
  return out;
}

function prWatch(herd: Herd, id: string) {
  if (!id.startsWith("pr:")) throw new Error(`no such watch: ${id}`);
  const w = herd.store.prWatches().find((x) => prKey(x) === id.slice(3));
  if (w === undefined) throw new Error(`no such watch: ${id}`);
  return w;
}

export function pauseWatch(herd: Herd, id: string, paused: boolean): void {
  const w = prWatch(herd, id);
  herd.store.savePrWatch({ ...w, paused });
  herd.store.audit("watch.paused", { id, paused });
}

export function deleteWatch(herd: Herd, id: string): void {
  herd.store.deletePrWatch(prWatch(herd, id));
  herd.store.audit("watch.removed", { id });
}
