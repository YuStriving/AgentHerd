// 主管: the Herder's action trail (行动记录) and what its requests are made of (上下文, ADR 0093).
// Its model is chosen on the 模型 page; when the Herder is not working, one line says why and
// links there.

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { herderReasonLabel } from "../components/labels";
import { Button, Segmented } from "../components/ui";
import { useApp } from "../store";
import { HerderActivity } from "./HerderActivityPage";
import { HerderContextPanel } from "./HerderContextPage";

type HerderTab = "trail" | "context";
const TAB_KEY = "agentherd.herder.tab";
const TABS = [
  { value: "trail", label: "行动记录" },
  { value: "context", label: "上下文" },
] as const;

function savedTab(): HerderTab {
  try {
    return localStorage.getItem(TAB_KEY) === "context" ? "context" : "trail";
  } catch {
    return "trail";
  }
}

export function HerdersPage() {
  const herder = useApp((s) => s.status?.herder);
  const setPage = useApp((s) => s.setPage);
  const [tab, setTab] = useState<HerderTab>(savedTab);
  const choose = (next: HerderTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // A page without storage just forgets the tab.
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {herder !== undefined && !herder.on && (
        <div className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-md text-warning-text">
          <CircleAlert size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">主管没在工作：{herderReasonLabel(herder.reason)}</span>
          <Button size="sm" onClick={() => setPage("models")}>
            去模型页
          </Button>
        </div>
      )}
      <Segmented label="主管页" options={TABS} value={tab} onChange={choose} />
      {tab === "trail" ? <HerderActivity /> : <HerderContextPanel />}
    </div>
  );
}
