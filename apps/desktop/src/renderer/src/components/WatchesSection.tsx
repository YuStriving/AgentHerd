// 信箱 › 任务开的 PR (ADR 0058, 0100): the pull requests tasks opened, which AgentHerd keeps an eye
// on for CI, reviews and merging. They belong to their tasks; the owner can pause or drop one here.
// Everything else the owner asked to hear about is a mailbox source above.

import type { WatchView } from "@agentherd/host/api";
import { GitPullRequest, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "../store";
import { Badge, Button, Group, Section, Switch } from "./ui";

/** 「刚刚」「5 分钟前」「3 小时前」「2 天前」, or 「11月3日」 when older than a week. */
export function ago(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const ms = now - at.getTime();
  if (Number.isNaN(ms)) return iso;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return `${at.getMonth() + 1}月${at.getDate()}日`;
}

function WatchRow({ watch, onList }: { watch: WatchView; onList: (w: WatchView[]) => void }) {
  const [busy, setBusy] = useState(false);
  const apply = async (action: () => Promise<WatchView[] | undefined>) => {
    setBusy(true);
    const next = await action();
    setBusy(false);
    if (next !== undefined) onList(next);
  };
  const remove = () => {
    if (!window.confirm(`不再盯着「${watch.title}」？`)) return;
    void apply(() => call((h) => h.removeWatch(watch.id)));
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <GitPullRequest size={14} className="shrink-0 text-ink-dim" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink text-md" title={watch.title}>
            {watch.title}
          </span>
          {watch.paused && <Badge tone="amber">已暂停</Badge>}
        </div>
        <div className="truncate text-ink-muted text-sm">
          {watch.detail}
          {watch.activeAt !== undefined && ` · 最近动静 ${ago(watch.activeAt)}`}
        </div>
      </div>
      <Switch
        label={watch.paused ? "继续" : "暂停"}
        checked={!watch.paused}
        disabled={busy}
        onChange={(on) => void apply(() => call((h) => h.setWatchPaused(watch.id, !on)))}
      />
      <Button variant="ghost" size="sm" aria-label="删除" disabled={busy} onClick={remove}>
        <Trash2 size={13} />
      </Button>
    </div>
  );
}

/** The tasks' pull requests; nothing is shown while there are none. */
export function PrWatches() {
  const [watches, setWatches] = useState<WatchView[] | undefined>();
  useEffect(() => {
    void call((h) => h.watches()).then((w) => w !== undefined && setWatches(w));
  }, []);
  if (watches === undefined || watches.length === 0) return null;
  return (
    <Section title="任务开的 PR" hint="任务开的 PR 有 CI、评审和合并的动静会自己告诉你">
      <Group>
        {watches.map((w) => (
          <WatchRow key={w.id} watch={w} onList={setWatches} />
        ))}
      </Group>
    </Section>
  );
}
