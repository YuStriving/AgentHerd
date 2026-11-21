// 主管: what the Herder's requests are made of (上下文, ADR 0093) and its action trail (行动记录).
// The page always opens on 上下文 (ADR 0096). Its model is chosen on the 模型 page; when the
// Herder is not working, one line says why and links there.

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { herderReasonLabel } from "../components/labels";
import { Button, Segmented } from "../components/ui";
import { useApp } from "../store";
import { HerderActivity } from "./HerderActivityPage";
import { HerderContextPanel } from "./HerderContextPage";

type HerderTab = "context" | "trail";
const TABS = [
  { value: "context", label: "上下文" },
  { value: "trail", label: "行动记录" },
] as const;

export function HerdersPage() {
  const herder = useApp((s) => s.status?.herder);
  const setPage = useApp((s) => s.setPage);
  const [tab, setTab] = useState<HerderTab>("context");
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
      <Segmented label="主管页" options={TABS} value={tab} onChange={setTab} />
      {tab === "context" ? <HerderContextPanel /> : <HerderActivity />}
    </div>
  );
}
