// 主管: every Herder turn — what started it, each tool it called with the answer, and
// what it said — plus errors, retries and model switches. Read from the Herder's saved
// conversation; the page asks again every few seconds while it is open.

import type {
  HerderActivityStep,
  HerderActivityTurn,
  HerderActivityView,
  HerderIncident,
} from "@agentherd/host/api";
import { AlertTriangle, ChevronDown, ChevronRight, History } from "lucide-react";
import { useEffect, useState } from "react";
import { hhmm } from "../components/labels";
import { Badge, EmptyState, Group, Segmented } from "../components/ui";
import { host } from "../store";

const POLL_MS = 5000;

const TRIGGERS: Record<HerderActivityTurn["trigger"], string> = {
  owner: "你说",
  answer: "你选了",
  task: "任务结果",
  scheduled: "定时任务",
  intake: "新活",
  notice: "收到通知",
  other: "其他",
};

/** What each Herder tool does, in the owner's words. */
const TOOLS: Record<string, string> = {
  session_start: "开任务",
  session_prompt: "给任务发消息",
  session_list: "看任务列表",
  session_cancel: "打断任务",
  session_end: "结束任务",
  task_read: "看任务的回复",
  task_search: "找以前的任务",
  project_find: "找项目",
  ask: "问你",
  notify: "通知你",
  memory: "改记忆",
  memory_search: "查记忆",
  decisions_list: "看定了的事",
  schedule_add: "建定时任务",
  schedule_change: "改定时任务",
  schedule_remove: "删定时任务",
  mail_watch: "盯邮件",
  mail_unwatch: "不再盯邮件",
  intake_watch: "盯新活",
  intake_unwatch: "不再盯新活",
  social_watch: "改平台提醒",
  notice_level: "改消息去处",
  style_set: "换说话风格",
  feed_read: "看资讯",
  stock_quote: "查行情",
  fund_holdings: "查基金持仓",
  relay_start: "开始转发",
  relay_end: "结束转发",
  compress: "折叠旧对话",
  decompress: "展开旧对话",
  search_context: "翻旧对话",
  acp_status: "看对话长度",
};

/** The argument that says most about a call, shown on its line. */
const KEY_ARGS = ["text", "question", "project", "query", "task", "name", "about", "kind"];

function keyArg(step: HerderActivityStep): string {
  for (const k of KEY_ARGS) {
    const v = step.args[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
}

function incidentText(i: HerderIncident): { text: string; bad: boolean } {
  const d = i.data;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  switch (i.kind) {
    case "herder.error":
      return { text: `出错，这一轮没做完：${s("message")}`, bad: true };
    case "herder.retry":
      return { text: `模型出错，稍后重试：${s("message")}`, bad: false };
    case "herder.model-switched":
      return { text: `换了模型：${s("from")} → ${s("to")}（${s("why")}）`, bad: false };
    case "herder.guard":
      return { text: `被安全名单拦下：${s("reason")}`, bad: true };
    case "herder.reply.markup":
      return { text: "模型把工具调用写成了文字，没有发给你", bad: true };
    case "herder.context.overflow":
    case "herder.context.forced-fold":
    case "herder.context.compress":
      return { text: "对话太长，折叠了一部分旧对话", bad: false };
    case "herder.context.error":
    case "herder.context.full":
      return { text: `整理对话出错：${s("message")}`, bad: true };
    case "herder.pending.resumed":
      return { text: "重启后，接着处理重启前没做完的消息", bad: false };
    case "herder.pending.dropped":
      return { text: "重启前的一条消息放太久了（超过一天），没有再处理", bad: true };
    case "herder.pending.quiet":
      return { text: "重启前的消息已经处理过，这次没再说话", bad: false };
    default:
      return { text: i.kind, bad: false };
  }
}

type Entry =
  | { at: string; kind: "turn"; turn: HerderActivityTurn }
  | { at: string; kind: "incident"; incident: HerderIncident };

function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function StepLine({ step }: { step: HerderActivityStep }) {
  const [open, setOpen] = useState(false);
  const arg = keyArg(step);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-1.5 text-left text-sm hover:text-ink"
      >
        <span className={`mt-0.5 shrink-0 ${step.error ? "text-danger-text" : "text-ink-dim"}`}>
          {step.error ? "✗" : "·"}
        </span>
        <span className="font-medium text-ink-2">{TOOLS[step.tool] ?? step.tool}</span>
        {arg !== "" && <span className="min-w-0 flex-1 truncate text-ink-muted">{arg}</span>}
      </button>
      {open && (
        <div className="mt-1 mb-2 ml-4 flex flex-col gap-1.5 text-xs">
          <pre className="whitespace-pre-wrap break-all rounded bg-control-hover px-2 py-1.5 text-ink-2">
            {step.tool} {JSON.stringify(step.args, null, 2)}
          </pre>
          <pre
            className={`max-h-60 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 ${
              step.error ? "bg-danger-soft text-danger-text" : "bg-control-hover text-ink-muted"
            }`}
          >
            {step.result === "" ? "（没有结果）" : step.result}
          </pre>
        </div>
      )}
    </li>
  );
}

function TurnRow({ turn }: { turn: HerderActivityTurn }) {
  const [open, setOpen] = useState(false);
  const failed = turn.steps.filter((s) => s.error).length;
  const silent = turn.reply === "";
  const asked = turn.steps.some((s) => s.tool === "ask");
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-hover"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-ink-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-ink-muted" />
        )}
        <span className="w-10 shrink-0 text-ink-muted text-sm tabular-nums">{hhmm(turn.at)}</span>
        <span className="shrink-0 text-ink-muted text-sm">{TRIGGERS[turn.trigger]}</span>
        <span className="min-w-0 flex-1 truncate text-ink">
          {turn.text === "" ? (turn.events[0] ?? "") : turn.text}
        </span>
        {turn.resumed && <Badge tone="blue">重启前的</Badge>}
        {turn.steps.length > 0 && <Badge>{turn.steps.length} 步</Badge>}
        {failed > 0 && <Badge tone="red">{failed} 步失败</Badge>}
        {silent && !asked && <Badge tone="gray">没说话</Badge>}
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-4 pt-1 pb-4 pl-[3.25rem] text-md">
          {turn.question !== undefined && (
            <div className="text-ink-muted text-sm">问的是：{turn.question}</div>
          )}
          {turn.events.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-ink-muted text-xs">一起收到的通知</div>
              {turn.events.map((e) => (
                <div key={e} className="line-clamp-3 whitespace-pre-wrap text-ink-2 text-sm">
                  {e}
                </div>
              ))}
            </div>
          )}
          {turn.steps.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-ink-muted text-xs">做了这些（点一步看参数和结果）</div>
              <ul className="flex flex-col gap-1">
                {turn.steps.map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: steps never move
                  <StepLine key={i} step={s} />
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <div className="text-ink-muted text-xs">
              回你的话{turn.model === undefined ? "" : ` · ${turn.model}`}
            </div>
            <div className="whitespace-pre-wrap text-ink">
              {turn.quiet
                ? "（决定不说话）"
                : turn.reply !== ""
                  ? turn.reply
                  : asked
                    ? "（用选项卡问了你）"
                    : "（没有回话）"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentRow({ incident }: { incident: HerderIncident }) {
  const { text, bad } = incidentText(incident);
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 text-sm">
      <AlertTriangle size={14} className={bad ? "text-danger-text" : "text-warning-text"} />
      <span className="w-10 shrink-0 text-ink-muted tabular-nums">{hhmm(incident.at)}</span>
      <span className={`min-w-0 flex-1 truncate ${bad ? "text-danger-text" : "text-ink-2"}`}>
        {text}
      </span>
    </div>
  );
}

export function HerderActivity() {
  const [view, setView] = useState<HerderActivityView | undefined>();
  const [filter, setFilter] = useState<"all" | "problems">("all");

  useEffect(() => {
    let alive = true;
    const load = () =>
      host()
        .herderActivity()
        .then((v) => {
          if (alive) setView(v);
        })
        .catch(() => {
          // The connection banner explains a host that is not there.
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (view === undefined) return null;
  if (view.turns.length === 0 && view.incidents.length === 0) {
    return (
      <Group>
        <EmptyState
          icon={<History size={18} />}
          title="还没有记录"
          text="在飞书里跟主管说句话，它的每一步都会记在这里。"
        />
      </Group>
    );
  }

  const entries: Entry[] = [
    ...view.turns.map((turn) => ({ at: turn.at, kind: "turn" as const, turn })),
    ...view.incidents.map((incident) => ({ at: incident.at, kind: "incident" as const, incident })),
  ]
    .filter((e) =>
      filter === "all"
        ? true
        : e.kind === "incident"
          ? incidentText(e.incident).bad || e.incident.kind === "herder.retry"
          : e.turn.steps.some((s) => s.error),
    )
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const days: { day: string; entries: Entry[] }[] = [];
  for (const e of entries) {
    const day = dayOf(e.at);
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(e);
    else days.push({ day, entries: [e] });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Segmented
          label="显示"
          options={[
            { value: "all", label: "全部" },
            { value: "problems", label: "出错的" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <span className="text-ink-muted text-sm">
          {view.total > view.turns.length
            ? `最近 ${view.turns.length} 轮，一共 ${view.total} 轮`
            : `一共 ${view.total} 轮`}
        </span>
      </div>
      {days.length === 0 && <div className="text-ink-muted text-md">没有出错的记录。</div>}
      {days.map(({ day, entries: list }) => (
        <section key={day} className="flex flex-col gap-2">
          <h2 className="font-medium text-ink-muted text-sm">{day}</h2>
          <Group>
            {list.map((e) =>
              e.kind === "turn" ? (
                <TurnRow key={`t${e.at}`} turn={e.turn} />
              ) : (
                <IncidentRow key={`i${e.at}${e.incident.kind}`} incident={e.incident} />
              ),
            )}
          </Group>
        </section>
      ))}
    </div>
  );
}
