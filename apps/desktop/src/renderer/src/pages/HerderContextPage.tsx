// 主管 → 上下文 (ADR 0093, ADR 0095): what the Herder's next request carries, which stretches of
// its conversation are folded and where the model reads them, its requests and their cost.
// Everything comes from herd.db through the host, so the tab works while the Herder is off.

import type {
  HerderContextNow,
  HerderContextPart,
  HerderContextView,
  HerderFoldView,
  HerderMessageView,
} from "@agentherd/host/api";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components/Modal";
import { Badge, Button, EmptyState, Group, Segmented } from "../components/ui";
import {
  CACHE_COLOR,
  type ContextNode,
  clockOf,
  contextRecords,
  contextTree,
  dayOf,
  dollars,
  drawnTree,
  FOLD_BY_LABELS,
  FOLD_COLOR,
  foldMarks,
  formatTokens,
  INPUT_COLOR,
  itemsOf,
  kindsLine,
  type MapBox,
  mapLayout,
  messageColor,
  messageLine,
  PART_COLORS,
  PART_HINTS,
  PART_LABELS,
  partsBySize,
  percent,
  spanOf,
  summaryWhere,
  timeOf,
  WINDOW_OPTIONS,
  windowLine,
} from "../herder-context";
import { call, host } from "../store";

const POLL_MS = 5000;
const RAW_COLOR = PART_COLORS.herder;
const RECORDS_SHOWN = 30;

function Card({
  title,
  note,
  right,
  children,
}: {
  title: string;
  note?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Group>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-semibold text-ink text-md">{title}</h3>
            {note !== undefined && <div className="text-ink-muted text-sm">{note}</div>}
          </div>
          {right}
        </div>
        {children}
      </div>
    </Group>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
      style={{ background: color }}
    />
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-control px-3 py-2.5">
      <span className="truncate font-semibold text-ink text-md tabular-nums">{value}</span>
      <span className="line-clamp-2 text-ink-muted text-xs" title={label}>
        {label}
      </span>
    </div>
  );
}

// ---------- 现在送给模型的

function NowCard({ view, onWindow }: { view: HerderContextView; onWindow: () => void }) {
  const { now, facts } = view;
  const last = view.requests.at(-1);
  const first = view.rounds[0];
  return (
    <Card
      title="现在送给模型的"
      note={
        view.on
          ? "按库里的对话和折叠现算的，就是主管下一次请求要带的内容"
          : "主管没在跑；这是按库里的对话现算的，它下次开工时会带这些"
      }
      right={view.on ? <Badge tone="green">主管在跑</Badge> : <Badge>主管没在跑</Badge>}
    >
      {now === undefined ? (
        <p className="text-danger-text text-sm">算不出来：{view.problem ?? "还没有对话"}</p>
      ) : (
        <>
          <NowBar now={now} />
          <WindowPicker now={now} onWindow={onWindow} />
        </>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Fact
          value={`${facts.messages} 条 · ≈${formatTokens(facts.tokens)}`}
          label={`库里的全部对话${first === undefined ? "" : `（${dayOf(first.at)} 起，${facts.rounds} 轮）`}`}
        />
        <Fact
          value={`${facts.activeFolds} 段折叠 · 省 ≈${formatTokens(facts.saved)}`}
          label={`折了 ${facts.messages - facts.shown} 条，换成了摘要`}
        />
        <Fact value={`${facts.shown} 条原文`} label="模型原样看到的消息" />
        <Fact
          value={
            last === undefined
              ? "还没有请求"
              : `${timeOf(last.at)}${facts.lastHitRate === undefined ? "" : ` · 命中 ${percent(facts.lastHitRate, 1)}`}`
          }
          label={last === undefined ? "主管还没发过请求" : `最后一次请求 · ${last.model}`}
        />
      </div>
    </Card>
  );
}

function NowBar({ now }: { now: HerderContextNow }) {
  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-[30px] text-ink tabular-nums leading-none tracking-tight">
          ≈{formatTokens(now.tokens)}
        </span>
        <span className="text-ink-muted text-md tabular-nums">
          / {formatTokens(now.window)} · {percent(now.tokens, now.window)}
        </span>
      </div>
      <div className="relative h-3.5 w-full rounded-full bg-control-hover">
        <div className="flex h-full overflow-hidden rounded-full">
          {partsOrder(now).map((p) => (
            <div
              key={p}
              title={`${PART_LABELS[p]} ≈${formatTokens(now.parts[p])}`}
              style={{ width: `${(now.parts[p] / now.window) * 100}%`, background: PART_COLORS[p] }}
            />
          ))}
        </div>
        <div
          className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-danger"
          style={{ left: `${(now.foldAt / now.window) * 100}%` }}
          title="到这里 AgentHerd 会自动折叠最早的对话"
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {partsOrder(now).map((p) => (
          <span key={p} className="flex items-center gap-1.5" title={PART_HINTS[p]}>
            <Swatch color={PART_COLORS[p]} />
            <span className="text-ink-2">{PART_LABELS[p]}</span>
            <span className="text-ink-muted tabular-nums">{formatTokens(now.parts[p])}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-danger-text">
          <span className="inline-block h-3 w-0.5 rounded-full bg-danger" />
          90% 自动折叠线
        </span>
      </div>
      {now.noPrompt === true && (
        <p className="text-ink-dim text-xs">
          系统提示词和工具定义要等主管在这一版里发出第一次请求才记下来，现在没算进去。
        </p>
      )}
    </>
  );
}

/** The owner picks the working window (ADR 0097); the model's own window stays the upper limit. */
function WindowPicker({ now, onWindow }: { now: HerderContextNow; onWindow: () => void }) {
  const [busy, setBusy] = useState(false);
  const pick = async (value: string) => {
    setBusy(true);
    await call((h) => h.updateSettings({ herderWindow: Number(value) }));
    setBusy(false);
    onWindow();
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-control px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-ink-2 text-sm">主管的工作窗口 · {windowLine(now)}</div>
        <div className="text-ink-dim text-xs">
          {
            "对话到了窗口的 90%，主管就把最早的部分折成摘要。窗口大，原文留得多，但每次回复更慢、更贵；不会超过模型自己的上限。"
          }
        </div>
      </div>
      <div className={busy ? "pointer-events-none opacity-60" : ""}>
        <Segmented
          label="主管的工作窗口"
          options={WINDOW_OPTIONS}
          value={String(now.choice)}
          onChange={(v) => void pick(v)}
        />
      </div>
    </div>
  );
}

function partsOrder(now: HerderContextNow): HerderContextPart[] {
  const sized = new Set(partsBySize(now.parts));
  return (["system", "tools", "memory", "folds", "owner", "herder", "results"] as const).filter(
    (p) => sized.has(p),
  );
}

// ---------- 上下文地图

const MAP_W = 760;
const TOP_Y = 34;
const BOX_H = 26;
const BOTTOM_Y = 136;

function boxColor(b: MapBox): string {
  return b.kind === "part" && b.part !== undefined
    ? PART_COLORS[b.part]
    : b.kind === "fold"
      ? FOLD_COLOR
      : RAW_COLOR;
}

function MapCard({
  view,
  selected,
  select,
  showOriginals,
}: {
  view: HerderContextView;
  selected: string | undefined;
  select: (key: string) => void;
  showOriginals: (blockId: string) => void;
}) {
  const layout = useMemo(() => mapLayout(view), [view]);
  if (layout.top.length === 0) return null;
  const px = (share: number) => share * MAP_W;
  const ribbons = layout.top.flatMap((t) => {
    const b = layout.bottom.find((x) => x.key === t.key);
    if (b === undefined) return [];
    const fill = t.kind === "fold" ? "rgba(232,163,61,.22)" : "rgba(59,130,246,.14)";
    const d = `M${px(t.x)},${TOP_Y + BOX_H} L${px(t.x + t.w)},${TOP_Y + BOX_H} L${px(b.x + b.w)},${BOTTOM_Y} L${px(b.x)},${BOTTOM_Y} Z`;
    return [<path key={t.key} d={d} fill={fill} />];
  });
  const boxes = (row: MapBox[], y: number, label: (b: MapBox) => string) =>
    row.map((b) => {
      const on = selected === b.key;
      const clickable = b.kind !== "part";
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: a chart segment; the tree below does the same by keyboard
        <g
          key={`${y}:${b.key}`}
          className={clickable ? "cursor-pointer" : ""}
          onClick={clickable ? () => select(b.key) : undefined}
        >
          <title>{mapTitle(b, view)}</title>
          <rect
            x={px(b.x)}
            y={y}
            width={Math.max(1.5, px(b.w) - 1)}
            height={BOX_H}
            rx={3}
            fill={boxColor(b)}
            stroke={on ? "var(--color-ink)" : "none"}
            strokeWidth={on ? 2 : 0}
          />
          {px(b.w) > 58 && (
            <text x={px(b.x) + 6} y={y + 17} className="fill-white font-semibold text-[11px]">
              {label(b)}
            </text>
          )}
        </g>
      );
    });
  const windowX = layout.windowAt === undefined ? undefined : px(layout.windowAt);
  return (
    <Card
      title="上下文地图"
      note="上面是库里的全部对话，下面是现在送给模型的，比例尺相同；橙色段折成了摘要，点一段看详情"
    >
      <svg
        viewBox={`-2 0 ${MAP_W + 70} ${BOTTOM_Y + BOX_H + 26}`}
        className="block w-full"
        role="img"
        aria-label="上下文地图"
      >
        <text x={0} y={TOP_Y - 12} className="fill-(--color-ink) font-semibold text-[12px]">
          库里的全部对话 · {view.facts.messages} 条 · ≈{formatTokens(layout.topTokens)}
        </text>
        {ribbons}
        {boxes(layout.top, TOP_Y, (b) =>
          b.kind === "fold"
            ? `${b.blockId} · ${formatTokens(b.tokens)}`
            : `原文 · ${formatTokens(b.tokens)}`,
        )}
        {boxes(layout.bottom, BOTTOM_Y, (b) =>
          b.kind === "part" && b.part !== undefined
            ? PART_LABELS[b.part]
            : b.kind === "fold"
              ? "摘要"
              : `原文 · ${formatTokens(b.tokens)}`,
        )}
        {windowX !== undefined && windowX <= MAP_W + 60 && (
          <>
            <line
              x1={windowX}
              x2={windowX}
              y1={BOTTOM_Y - 6}
              y2={BOTTOM_Y + BOX_H + 6}
              stroke="var(--color-ink-muted)"
              strokeDasharray="2 3"
            />
            <text
              x={windowX + 4}
              y={BOTTOM_Y + BOX_H + 18}
              className="fill-(--color-ink-muted) text-[11px]"
            >
              工作窗口 {formatTokens(view.now?.window ?? 0)}
            </text>
          </>
        )}
        <text
          x={0}
          y={BOTTOM_Y + BOX_H + 18}
          className="fill-(--color-ink) font-semibold text-[12px]"
        >
          现在送给模型的 · ≈{formatTokens(layout.bottomTokens)}
        </text>
      </svg>
      <SelectedDetail view={view} selected={selected} showOriginals={showOriginals} />
    </Card>
  );
}

function mapTitle(b: MapBox, view: HerderContextView): string {
  if (b.kind === "part" && b.part !== undefined)
    return `${PART_LABELS[b.part]} ≈${formatTokens(b.tokens)}`;
  if (b.kind === "fold") {
    const f = view.folds.find((x) => x.blockId === b.blockId);
    return `${b.blockId} · ${f?.topic ?? "折叠"} · ≈${formatTokens(b.tokens)}`;
  }
  return `原文 #${b.startSeq}–#${b.endSeq} · ≈${formatTokens(b.tokens)}`;
}

function SelectedDetail({
  view,
  selected,
  showOriginals,
}: {
  view: HerderContextView;
  selected: string | undefined;
  showOriginals: (blockId: string) => void;
}) {
  if (selected === undefined) return null;
  const fold = view.folds.find((f) => f.blockId === selected);
  if (fold !== undefined)
    return <FoldDetail fold={fold} view={view} showOriginals={showOriginals} />;
  const raw = view.segments.find(
    (s): s is Extract<HerderContextView["segments"][number], { kind: "raw" }> =>
      s.kind === "raw" && `raw:${s.startSeq}` === selected,
  );
  if (raw === undefined) return null;
  const rounds = view.rounds.filter((r) => r.seq <= raw.endSeq && r.endSeq >= raw.startSeq);
  return (
    <div className="flex flex-col gap-1.5 border-line border-t pt-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-ink text-md">
          原文 #{raw.startSeq}–#{raw.endSeq}
        </span>
        <Badge tone="blue">模型原样看到</Badge>
      </div>
      <Kv
        k="时间"
        v={rounds.length === 0 ? "" : spanOf(rounds[0]?.at ?? "", rounds.at(-1)?.at ?? "")}
      />
      <Kv k="条数" v={`${raw.messages} 条，${rounds.length} 轮`} />
      <Kv k="大小" v={`≈${formatTokens(raw.tokens)}`} />
      <p className="text-ink-dim text-xs">
        最新的几条永远不折；主管觉得哪段做完了会自己折，到 90% 时 AgentHerd 自动折最早的。
      </p>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-ink-muted">{k}</span>
      <span className="min-w-0 flex-1 text-ink-2">{v}</span>
    </div>
  );
}

function FoldDetail({
  fold,
  view,
  showOriginals,
}: {
  fold: HerderFoldView;
  view: HerderContextView;
  showOriginals: (blockId: string) => void;
}) {
  const saved = fold.tokensBefore - fold.tokensAfter;
  return (
    <div className="grid gap-4 border-line border-t pt-3 text-sm md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink text-md">
            {fold.blockId} · {fold.topic ?? "折叠的一段"}
          </span>
          <Badge tone="amber">{FOLD_BY_LABELS[fold.by]}</Badge>
          {fold.level > 1 && <Badge>第 {fold.level} 层</Badge>}
          {fold.pending === true && <Badge tone="orange">下次请求时才折</Badge>}
        </div>
        <Kv k="时间" v={spanOf(fold.startAt, fold.endAt)} />
        <Kv
          k="折了"
          v={`#${fold.startSeq}–#${fold.endSeq}，${fold.messages} 条 · ${fold.rounds} 轮：${kindsLine(fold.kinds)}`}
        />
        <Kv
          k="大小"
          v={`原文 ≈${formatTokens(fold.tokensBefore)} → 摘要 ≈${formatTokens(fold.tokensAfter)}${saved > 0 ? `，省 ${percent(saved, fold.tokensBefore)}` : ""}`}
        />
        <Kv k="折的时间" v={clockOf(fold.createdAt)} />
        <Kv k="摘要在哪" v={summaryWhere(fold)} />
        {fold.children.length > 0 && <Kv k="里面" v={`包着 ${fold.children.join("、")}`} />}
        <div className="mt-1 flex gap-2">
          <Button size="sm" onClick={() => showOriginals(fold.blockId)}>
            看原文（{fold.messages} 条）
          </Button>
        </div>
        {view.on === false && fold.pending === true && (
          <p className="text-ink-dim text-xs">主管现在没在跑，这一段要等它下一次请求时才折。</p>
        )}
      </div>
      <pre className="max-h-72 min-w-0 overflow-auto whitespace-pre-wrap rounded-lg bg-inset p-3 text-ink-2 text-xs leading-relaxed">
        {fold.summary}
      </pre>
    </div>
  );
}

// ---------- 上下文树

type TreeMode = "list" | "drawn";
const TREE_MODES = [
  { value: "list", label: "列表" },
  { value: "drawn", label: "树图" },
] as const;

function TreeCard({
  view,
  selected,
  select,
  showOriginals,
}: {
  view: HerderContextView;
  selected: string | undefined;
  select: (key: string) => void;
  showOriginals: (blockId: string) => void;
}) {
  const [mode, setMode] = useState<TreeMode>("list");
  const tree = useMemo(() => contextTree(view), [view]);
  return (
    <Card
      title="上下文树"
      note="从上往下就是模型读的顺序。橙色是折叠段，模型只读最外层的摘要；蓝色是原样读的原文"
      right={<Segmented label="树的样子" options={TREE_MODES} value={mode} onChange={setMode} />}
    >
      {mode === "list" ? (
        <ListTree
          view={view}
          tree={tree}
          selected={selected}
          select={select}
          showOriginals={showOriginals}
        />
      ) : (
        <DrawnTreeView tree={tree} view={view} selected={selected} select={select} />
      )}
    </Card>
  );
}

const TAGS: Record<ContextNode["kind"], { label: string; className: string }> = {
  part: { label: "开头", className: "bg-control-hover text-ink-2" },
  fold: { label: "折叠", className: "text-white" },
  raw: { label: "原文", className: "text-white" },
  round: { label: "一轮", className: "bg-control-hover text-ink-2" },
};

function nodeKey(n: ContextNode): string | undefined {
  return n.kind === "fold" ? n.fold?.blockId : n.kind === "raw" ? `raw:${n.startSeq}` : undefined;
}

function ListTree({
  view,
  tree,
  selected,
  select,
  showOriginals,
}: {
  view: HerderContextView;
  tree: ContextNode[];
  selected: string | undefined;
  select: (key: string) => void;
  showOriginals: (blockId: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => {
    const last = [...tree].reverse().find((n) => n.kind === "raw");
    return new Set(last === undefined ? [] : [last.id]);
  });
  const [messages, setMessages] = useState<Record<string, HerderMessageView[] | string>>({});
  const box = useRef<HTMLDivElement>(null);
  // A choice on the map opens the same node here and brings it into view.
  useEffect(() => {
    if (selected === undefined) return;
    const id = selected.startsWith("raw:") ? selected : `fold:${selected}`;
    setOpen((o) => (o.has(id) ? o : new Set([...o, id])));
    const row = box.current?.querySelector(`[data-node="${CSS.escape(id)}"]`);
    if (row instanceof HTMLElement && box.current !== null)
      box.current.scrollTo({ top: row.offsetTop - box.current.offsetTop - 8, behavior: "smooth" });
  }, [selected]);
  const toggle = (n: ContextNode) => {
    const next = new Set(open);
    if (next.has(n.id)) next.delete(n.id);
    else {
      next.add(n.id);
      if (n.kind === "round" && n.round !== undefined && messages[n.id] === undefined) {
        const r = n.round;
        host()
          .herderMessages(r.seq, r.endSeq)
          .then((list) => setMessages((m) => ({ ...m, [n.id]: list })))
          .catch((e: Error) => setMessages((m) => ({ ...m, [n.id]: e.message })));
      }
    }
    setOpen(next);
    const key = nodeKey(n);
    if (key !== undefined) select(key);
  };
  const all = () => setOpen(new Set(tree.filter((n) => n.kind !== "part").map((n) => n.id)));
  const calls = new Map(
    view.folds
      .filter((f) => f.summaryAt === "call" && f.callSeq !== undefined)
      .map((f) => [f.callSeq, f]),
  );
  const row = (n: ContextNode, depth: number): ReactNode => {
    const isOpen = open.has(n.id);
    const tag = TAGS[n.kind];
    const tagColor = n.kind === "fold" ? FOLD_COLOR : n.kind === "raw" ? RAW_COLOR : undefined;
    const bg =
      n.kind === "fold"
        ? "bg-[rgba(232,163,61,.12)]"
        : n.kind === "raw"
          ? "bg-[rgba(59,130,246,.07)]"
          : "";
    const key = nodeKey(n);
    const on = key !== undefined && key === selected;
    const canOpen =
      n.children.length > 0 || n.kind === "round" || n.kind === "fold" || n.kind === "part";
    return (
      <div key={n.id}>
        <button
          type="button"
          data-node={n.id}
          onClick={() => toggle(n)}
          className={`flex w-full items-center gap-2 border-line border-b px-3 py-1.5 text-left text-sm hover:bg-hover ${bg} ${on ? "ring-2 ring-(color:--color-ink) ring-inset" : ""} ${n.kind === "fold" || n.kind === "raw" || n.kind === "part" ? "font-medium" : ""}`}
          style={{ paddingLeft: 12 + depth * 22 }}
        >
          <span className="w-3 shrink-0 text-ink-muted">
            {canOpen ? isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
          </span>
          {n.kind === "part" && n.part !== undefined ? (
            <Swatch color={PART_COLORS[n.part]} />
          ) : (
            <span
              className={`shrink-0 rounded px-1.5 text-[11px] ${tag.className}`}
              style={tagColor === undefined ? undefined : { background: tagColor }}
            >
              {tag.label}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-ink">{n.title}</span>
          {n.fold?.pending === true && <Badge tone="orange">下次请求时才折</Badge>}
          {n.time !== undefined && (
            <span className="shrink-0 text-ink-muted text-xs tabular-nums">{n.time}</span>
          )}
          {n.meta !== undefined && (
            <span className="w-36 shrink-0 text-right text-ink-muted text-xs">{n.meta}</span>
          )}
          <span className="w-28 shrink-0 text-right text-ink-2 tabular-nums">
            {n.before === undefined
              ? formatTokens(n.tokens)
              : `${formatTokens(n.before)} → ${formatTokens(n.tokens)}`}
          </span>
        </button>
        {isOpen && n.kind === "part" && view.now !== undefined && n.part !== undefined && (
          <PartItems now={view.now} part={n.part} depth={depth + 1} />
        )}
        {isOpen && n.kind === "fold" && n.fold !== undefined && (
          <div
            className="flex flex-col gap-2 border-line border-b bg-[rgba(232,163,61,.05)] py-2 pr-3 text-xs"
            style={{ paddingLeft: 46 + depth * 22 }}
          >
            <span className="text-ink-muted">{summaryWhere(n.fold)}</span>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-surface p-2 text-ink-2 leading-relaxed">
              {n.fold.summary}
            </pre>
            <div>
              <Button size="sm" onClick={() => showOriginals(n.fold?.blockId ?? "")}>
                看原文
              </Button>
            </div>
          </div>
        )}
        {isOpen && n.kind === "round" && (
          <RoundMessages list={messages[n.id]} depth={depth + 1} calls={calls} />
        )}
        {isOpen && n.children.map((c) => row(c, depth + 1))}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <Button size="sm" variant="ghost" onClick={all}>
          全部展开
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}>
          全部收起
        </Button>
        <span className="ml-auto text-ink-dim text-xs">
          一轮 = 主管被叫起来一次：你说话、任务交回结果或者别的事
        </span>
      </div>
      <div ref={box} className="relative max-h-[600px] overflow-auto rounded-lg border border-line">
        {tree.map((n) => row(n, 0))}
      </div>
    </div>
  );
}

function PartItems({
  now,
  part,
  depth,
}: {
  now: HerderContextNow;
  part: HerderContextPart;
  depth: number;
}) {
  const items = itemsOf(now, part);
  return (
    <div className="border-line border-b py-1" style={{ paddingLeft: 34 + depth * 22 }}>
      {items.length === 0 && <div className="py-1 text-ink-dim text-xs">没有内容</div>}
      {items.map((i) => (
        <details key={`${i.label}:${i.tokens}`} className="py-0.5 pr-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-ink-2">{i.label}</span>
            <span className="shrink-0 text-ink-muted text-xs tabular-nums">
              ≈{formatTokens(i.tokens)}
            </span>
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-2 text-ink-2 text-xs">
            {i.text}
            {i.more > 0 && `\n…（后面还有 ${i.more} 字）`}
          </pre>
        </details>
      ))}
    </div>
  );
}

function RoundMessages({
  list,
  depth,
  calls,
}: {
  list: HerderMessageView[] | string | undefined;
  depth: number;
  calls: Map<number | undefined, HerderFoldView>;
}) {
  const pad = { paddingLeft: 34 + depth * 22 };
  if (list === undefined)
    return (
      <div className="border-line border-b py-1.5 text-ink-dim text-xs" style={pad}>
        读取中…
      </div>
    );
  if (typeof list === "string")
    return (
      <div className="border-line border-b py-1.5 text-danger-text text-xs" style={pad}>
        {list}
      </div>
    );
  return (
    <div className="border-line border-b py-1" style={pad}>
      {list.map((m) => {
        const fold = calls.get(m.seq);
        return (
          <details key={m.seq} className="py-0.5 pr-3 text-sm">
            <summary className="flex cursor-pointer items-center gap-2">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: fold === undefined ? messageColor(m.role) : FOLD_COLOR }}
              />
              <span className="min-w-0 flex-1 truncate text-ink-2">
                {fold === undefined
                  ? messageLine(m)
                  : `调用 compress，折了 ${fold.blockId}（它的摘要就写在这条里）`}
              </span>
              <span className="shrink-0 text-ink-dim text-xs tabular-nums">
                {clockOf(m.at).slice(6)} · #{m.seq}
              </span>
              <span className="w-14 shrink-0 text-right text-ink-muted text-xs tabular-nums">
                {formatTokens(m.tokens)}
              </span>
            </summary>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-2 text-ink-2 text-xs">
              {m.text}
              {m.more > 0 && `\n…（后面还有 ${m.more} 字）`}
            </pre>
          </details>
        );
      })}
    </div>
  );
}

// The drawn tree: boxes joined by elbow lines, the request on the left.
const NODE_W = 214;
const NODE_H = 50;
const COL_W = 262;
const ROW_H = 62;

function DrawnTreeView({
  tree,
  view,
  selected,
  select,
}: {
  tree: ContextNode[];
  view: HerderContextView;
  selected: string | undefined;
  select: (key: string) => void;
}) {
  const drawn = useMemo(() => drawnTree(tree), [tree]);
  const at = new Map(drawn.nodes.map((n) => [n.id, n]));
  const xOf = (depth: number) => depth * COL_W;
  const yOf = (row: number) => row * ROW_H + 8;
  const width = xOf(drawn.depth) + NODE_W + 8;
  const height = drawn.rows * ROW_H + 8;
  const head = tree.filter((n) => n.kind === "part");
  return (
    <div className="overflow-auto rounded-lg border border-line p-3">
      <svg width={width} height={height} role="img" aria-label="折叠树">
        {drawn.links.map((l) => {
          const a = at.get(l.from);
          const b = at.get(l.to);
          if (a === undefined || b === undefined) return null;
          const x1 = xOf(a.depth) + NODE_W;
          const y1 = yOf(a.row) + NODE_H / 2;
          const x2 = xOf(b.depth);
          const y2 = yOf(b.row) + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`${l.from}>${l.to}`}
              d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
              fill="none"
              stroke="var(--color-line-strong)"
              strokeWidth={1.5}
            />
          );
        })}
        {drawn.nodes.map((d) => {
          const x = xOf(d.depth);
          const y = yOf(d.row);
          const n = d.node;
          let title: string;
          let line: string;
          let color: string;
          if (d.id === "request") {
            title = "下一次请求";
            line =
              view.now === undefined
                ? "算不出来"
                : `≈${formatTokens(view.now.tokens)} / ${formatTokens(view.now.window)}`;
            color = "var(--color-ink)";
          } else if (d.id === "head") {
            title = "开头";
            line = head
              .map((h) => `${HEAD_SHORT[h.part ?? "system"] ?? h.title} ${formatTokens(h.tokens)}`)
              .join(" · ");
            color = PART_COLORS.system;
          } else if (n?.kind === "fold" && n.fold !== undefined) {
            title = n.title;
            line =
              n.fold.state === "merged"
                ? `${n.fold.messages} 条 · 并进了 ${n.fold.parent ?? "上一层"}`
                : `${n.fold.messages} 条 · ${formatTokens(n.fold.tokensBefore)} → ${formatTokens(n.fold.tokensAfter)}`;
            color = FOLD_COLOR;
          } else {
            title = n?.title ?? "";
            line = `${n?.meta ?? ""} · ${formatTokens(n?.tokens ?? 0)}`;
            color = RAW_COLOR;
          }
          const key = n === undefined ? undefined : nodeKey(n);
          const on = key !== undefined && key === selected;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: a picture of the tree; the list view is the keyboard way
            <g
              key={d.id}
              className={key === undefined ? "" : "cursor-pointer"}
              onClick={key === undefined ? undefined : () => select(key)}
            >
              <title>{`${title}\n${line}${n?.time === undefined ? "" : `\n${n.time}`}`}</title>
              <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill="var(--color-surface-raised)"
                stroke={on ? "var(--color-ink)" : color}
                strokeWidth={on ? 2.5 : 1.5}
                strokeDasharray={n?.fold?.state === "merged" ? "5 4" : undefined}
                opacity={n?.fold?.state === "merged" ? 0.75 : 1}
              />
              <rect x={x} y={y} width={6} height={NODE_H} rx={3} fill={color} />
              <text
                x={x + 16}
                y={y + 20}
                className="fill-(--color-ink) font-semibold text-[12.5px]"
              >
                {clip(title, 22)}
              </text>
              <text x={x + 16} y={y + 38} className="fill-(--color-ink-muted) text-[11.5px]">
                {clip(line, 30)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-ink-dim text-xs">
        从左往右：下一次请求由开头和这几段组成；折叠段右边是它并进来的更早的折叠（虚线框），模型只读最外层的摘要。点一个框，上面的地图会选中它。
      </p>
    </div>
  );
}

const HEAD_SHORT: Partial<Record<HerderContextPart, string>> = {
  system: "提示词",
  tools: "工具",
  memory: "记忆",
};

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------- 每次请求 and 每天用量

const CHART_H = 150;

function RequestsCard({ view }: { view: HerderContextView }) {
  const list = view.requests;
  if (list.length === 0) return null;
  const width = 760;
  const step = width / Math.max(list.length, 60);
  const bar = Math.max(1, Math.min(14, step - 1));
  const peak = Math.max(1, ...list.map((r) => r.input + r.cacheRead + r.cacheWrite));
  const marks = foldMarks(list, view.folds);
  const ticks: { x: number; label: string }[] = [];
  let lastDay = "";
  let lastX = -100;
  list.forEach((r, i) => {
    const d = dayOf(r.at);
    if (d !== lastDay && i * step - lastX > 40) {
      ticks.push({ x: i * step, label: d });
      lastX = i * step;
    }
    lastDay = d;
  });
  return (
    <Card
      title="每次请求"
      note={`${list.length} 次请求（${dayOf(list[0]?.at ?? "")} 起），每根柱子是一次请求读进去的量`}
    >
      <svg
        viewBox={`0 0 ${width} ${CHART_H + 20}`}
        className="block w-full"
        role="img"
        aria-label="每次请求"
      >
        {list.map((r, i) => {
          const cached = (r.cacheRead / peak) * (CHART_H - 14);
          const fresh = ((r.input + r.cacheWrite) / peak) * (CHART_H - 14);
          const x = i * step;
          return (
            <g key={`${r.at}:${r.seq ?? ""}:${r.output}:${r.tokens}`}>
              <title>
                {`${clockOf(r.at)} · ${r.model}\n读进 ${formatTokens(r.input + r.cacheRead + r.cacheWrite)}（缓存命中 ${formatTokens(r.cacheRead)}）· 输出 ${formatTokens(r.output)}${r.cost > 0 ? ` · ${dollars(r.cost)}` : ""}${r.failed === true ? "\n这次失败了" : ""}`}
              </title>
              <rect x={x} y={CHART_H - cached} width={bar} height={cached} fill={CACHE_COLOR} />
              <rect
                x={x}
                y={CHART_H - cached - fresh}
                width={bar}
                height={fresh}
                fill={r.failed === true ? "var(--color-danger)" : INPUT_COLOR}
              />
            </g>
          );
        })}
        {marks.map((m) => (
          <g key={m.blockId}>
            <line
              x1={m.index * step}
              x2={m.index * step}
              y1={0}
              y2={CHART_H}
              stroke={FOLD_COLOR}
              strokeDasharray="3 2"
            />
            <text x={m.index * step + 3} y={11} className="fill-[#9a6312] text-[11px]">
              ✂ {m.blockId}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text
            key={t.label}
            x={t.x}
            y={CHART_H + 15}
            className="fill-(--color-ink-muted) text-[11px]"
          >
            {t.label}
          </text>
        ))}
      </svg>
      <Legend
        items={[
          [CACHE_COLOR, "缓存命中"],
          [INPUT_COLOR, "没命中的输入"],
          [FOLD_COLOR, "✂ 折叠"],
        ]}
      />
    </Card>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-ink-2 text-sm">
      {items.map(([color, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <Swatch color={color} />
          {label}
        </span>
      ))}
    </div>
  );
}

function DaysCard({ view }: { view: HerderContextView }) {
  const days = view.days;
  if (days.length === 0) return null;
  const t = view.total;
  const width = 760;
  const step = width / Math.max(days.length, 7);
  const bar = Math.min(44, step - 10);
  const peak = Math.max(1, ...days.map((d) => d.input + d.cacheRead + d.cacheWrite));
  return (
    <Card
      title="每天用量"
      note={`一共 ${t.requests} 次请求 · 读进 ${formatTokens(t.input + t.cacheRead + t.cacheWrite)}（缓存命中 ${percent(t.hitRate, 1)}）· 输出 ${formatTokens(t.output)}${t.cost > 0 ? ` · 约 ${dollars(t.cost)}` : ""}`}
    >
      <svg
        viewBox={`0 0 ${width} ${CHART_H + 20}`}
        className="block w-full"
        role="img"
        aria-label="每天用量"
      >
        {days.map((d, i) => {
          const cached = (d.cacheRead / peak) * (CHART_H - 10);
          const fresh = ((d.input + d.cacheWrite) / peak) * (CHART_H - 10);
          const x = i * step + 4;
          return (
            <g key={d.day}>
              <title>
                {`${d.day} · ${d.requests} 次请求\n读进 ${formatTokens(d.input + d.cacheRead + d.cacheWrite)}，命中 ${percent(d.hitRate, 1)} · 输出 ${formatTokens(d.output)}${d.cost > 0 ? ` · ${dollars(d.cost)}` : ""}`}
              </title>
              <rect
                x={x}
                y={CHART_H - cached}
                width={bar}
                height={cached}
                rx={2}
                fill={CACHE_COLOR}
              />
              <rect
                x={x}
                y={CHART_H - cached - fresh}
                width={bar}
                height={fresh}
                rx={2}
                fill={INPUT_COLOR}
              />
              <text x={x} y={CHART_H + 15} className="fill-(--color-ink-muted) text-[11px]">
                {d.day.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend
        items={[
          [CACHE_COLOR, "缓存命中"],
          [INPUT_COLOR, "没命中的输入"],
        ]}
      />
    </Card>
  );
}

// ---------- 折叠记录

function RecordsCard({ view, select }: { view: HerderContextView; select: (key: string) => void }) {
  const [all, setAll] = useState(false);
  const records = useMemo(() => contextRecords(view.folds, view.events), [view]);
  if (records.length === 0) return null;
  const shown = all ? records : records.slice(0, RECORDS_SHOWN);
  const forced = view.folds.filter((f) => f.by !== "herder").length;
  return (
    <Card
      title="折叠记录"
      note={`${view.folds.length} 段折叠${forced === 0 ? "，都是主管自己折的" : `，其中 ${forced} 段是自动折的`}`}
    >
      <div className="flex flex-col">
        {shown.map((r) => (
          <div
            key={`${r.at}:${r.title}`}
            className="flex gap-4 border-line border-b py-2 text-sm last:border-b-0"
          >
            <span className="w-24 shrink-0 text-ink-muted tabular-nums">{clockOf(r.at)}</span>
            <span className="min-w-0 flex-1">
              {r.blockId === undefined ? (
                <span className="font-medium text-ink">{r.title}</span>
              ) : (
                <button
                  type="button"
                  className="font-medium text-ink hover:underline"
                  onClick={() => select(r.blockId ?? "")}
                >
                  {r.title}
                </button>
              )}
              <span className="block text-ink-muted">{r.text}</span>
            </span>
          </div>
        ))}
      </div>
      {!all && records.length > RECORDS_SHOWN && (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          再看 {records.length - RECORDS_SHOWN} 条
        </Button>
      )}
    </Card>
  );
}

// ---------- the tab

function Originals({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const [text, setText] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    host()
      .herderContextFold(blockId)
      .then(setText)
      .catch((e: Error) => setError(e.message));
  }, [blockId]);
  return (
    <Modal
      title={`${blockId} 的原文`}
      description="折叠前的每一条消息"
      onClose={onClose}
      size="large"
    >
      {error !== undefined ? (
        <p className="text-danger-text text-sm">{error}</p>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg bg-inset p-3 text-ink-2 text-xs leading-relaxed">
          {text ?? "读取中…"}
        </pre>
      )}
    </Modal>
  );
}

export function HerderContextPanel() {
  const [view, setView] = useState<HerderContextView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [originals, setOriginals] = useState<string | undefined>();
  const key = useRef<string | undefined>(undefined);
  const reload = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    const load = () =>
      host()
        .herderContext(key.current)
        .then((v) => {
          if (!alive || "unchanged" in v) return;
          key.current = v.key;
          setView(v);
          setError(undefined);
        })
        .catch((e: Error) => {
          if (alive) setError(e.message);
        });
    reload.current = () => void load();
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (view === undefined)
    return error === undefined ? null : (
      <Group>
        <EmptyState icon={<Layers size={18} />} title="读不到上下文" text={error} />
      </Group>
    );
  if (view.facts.messages === 0)
    return (
      <Group>
        <EmptyState
          icon={<Layers size={18} />}
          title="主管还没说过话"
          text="跟主管说句话，这里会显示它每次请求带了哪些内容、哪些旧对话折成了摘要。"
        />
      </Group>
    );
  return (
    <div className="flex flex-col gap-4">
      <NowCard view={view} onWindow={() => reload.current()} />
      <MapCard view={view} selected={selected} select={setSelected} showOriginals={setOriginals} />
      <TreeCard view={view} selected={selected} select={setSelected} showOriginals={setOriginals} />
      <RequestsCard view={view} />
      <DaysCard view={view} />
      <RecordsCard view={view} select={setSelected} />
      {originals !== undefined && (
        <Originals blockId={originals} onClose={() => setOriginals(undefined)} />
      )}
    </div>
  );
}
