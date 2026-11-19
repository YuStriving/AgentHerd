// 应用连接 › 行情与投研 › 腾讯自选股 (ADR 0076): built-in zero-login live market quotes for
// the Herder + MCP tasks (`stock_quote` / `WESTOCK_QUOTE`) and one-click install/removal of the
// official `@tencent-adm/westock-data` CLI (`westock`) for deep research agents.

import type { WestockTest, WestockView } from "@agentherd/host/api";
import { Activity, Download, Loader2, RefreshCw, Trash2, TrendingUp } from "lucide-react";
import { useState } from "react";
import { call, useApp } from "../store";
import { ConnectionRow } from "./ConnectionRow";
import { Badge, Button, IconTile, Switch } from "./ui";

const READ_ABILITIES = [
  "查A股/港股/美股/ETF/大盘实时行情（主管秒回）",
  "查 K 线、技术指标、筹码、财报、资金与研报（安装 westock CLI）",
] as const;

function stateBadge(westock: WestockView | undefined) {
  if (westock === undefined) return <Badge>检查中…</Badge>;
  if (!westock.enabled) return <Badge>已关闭</Badge>;
  switch (westock.cliState) {
    case "installing":
      return <Badge tone="blue">正在安装 CLI</Badge>;
    case "ready":
      return <Badge tone="green">实时行情 · CLI {westock.version ?? "0.0.2"}</Badge>;
    case "failed":
      return <Badge tone="amber">实时行情已开 · CLI 异常</Badge>;
    default:
      return <Badge tone="green">实时行情已开</Badge>;
  }
}

export function WestockRow() {
  const westock = useApp((s) => s.westock);
  const [busy, setBusy] = useState<"toggle" | "install" | "remove" | "test" | "check">();
  const [testResult, setTestResult] = useState<WestockTest>();

  const toggleEnabled = async (on: boolean) => {
    setBusy("toggle");
    try {
      const next = await call((h) => h.setWestockEnabled(on));
      if (next !== undefined) useApp.setState({ westock: next });
    } finally {
      setBusy(undefined);
    }
  };

  const installCli = async () => {
    setBusy("install");
    try {
      const next = await call((h) => h.installWestock());
      if (next !== undefined) useApp.setState({ westock: next });
    } finally {
      setBusy(undefined);
    }
  };

  const removeCli = async () => {
    setBusy("remove");
    try {
      const next = await call((h) => h.removeWestock());
      if (next !== undefined) useApp.setState({ westock: next });
    } finally {
      setBusy(undefined);
    }
  };

  const refreshCli = async () => {
    setBusy("check");
    try {
      const next = await call((h) => h.westock());
      if (next !== undefined) useApp.setState({ westock: next });
    } finally {
      setBusy(undefined);
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTestResult(undefined);
    try {
      const res = await call((h) => h.testWestock());
      if (res !== undefined) {
        useApp.setState({ westock: res.westock });
        setTestResult(res);
      }
    } finally {
      setBusy(undefined);
    }
  };

  const installing = westock?.cliState === "installing" || busy === "install";
  const cliReady = westock?.cliState === "ready";

  return (
    <ConnectionRow
      icon={
        <IconTile tone={westock?.enabled ? "green" : "gray"}>
          <TrendingUp size={14} />
        </IconTile>
      }
      name="腾讯自选股"
      badge={stateBadge(westock)}
      subtitle="A股 · 港股 · 美股 · 主要指数与 ETF 实时报价（免登录）"
      alert={westock?.cliState === "failed"}
      action={
        <Switch
          checked={westock?.enabled ?? true}
          disabled={westock === undefined || busy !== undefined}
          label="启用腾讯自选股"
          onChange={(on) => void toggleEnabled(on)}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-ink-muted text-xs">直接做</span>
        {READ_ABILITIES.map((r) => (
          <Badge key={r}>{r}</Badge>
        ))}
      </div>

      {westock?.problem !== undefined && (
        <div className="rounded-md bg-danger-soft px-2.5 py-1.5 text-danger-text text-sm">
          {westock.problem}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void runTest()} disabled={busy !== undefined}>
          {busy === "test" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Activity size={13} />
          )}
          连接测试
        </Button>

        {installing ? (
          <Button size="sm" variant="primary" disabled>
            <Loader2 size={13} className="animate-spin" />
            正在安装官方 westock CLI…
          </Button>
        ) : cliReady ? (
          <>
            <Button size="sm" onClick={() => void refreshCli()} disabled={busy !== undefined}>
              {busy === "check" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              重新检测
            </Button>
            {westock.managed === true && (
              <Button size="sm" onClick={() => void removeCli()} disabled={busy !== undefined}>
                {busy === "remove" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                移除 CLI
              </Button>
            )}
          </>
        ) : westock?.supported ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void installCli()}
            disabled={busy !== undefined}
          >
            <Download size={13} />
            {westock.cliState === "failed" ? "重试安装 westock CLI" : "安装深度投研 CLI (westock)"}
          </Button>
        ) : (
          <span className="text-ink-muted text-xs">当前系统暂不支持一键安装官方 CLI</span>
        )}
      </div>

      {cliReady && westock.path !== undefined && (
        <div className="flex items-center gap-2 text-ink-muted text-xs">
          <span>
            官方 CLI ({westock.managed ? "AgentHerd 托管" : "系统 PATH"}): v
            {westock.version ?? "0.0.2"}
          </span>
          <span className="truncate font-mono" title={westock.path}>
            {westock.path}
          </span>
        </div>
      )}

      {testResult !== undefined && (
        <div className="flex flex-col gap-1.5">
          <div className={`text-sm ${testResult.ok ? "text-success-text" : "text-danger-text"}`}>
            {testResult.message}
          </div>
          {testResult.sample !== undefined && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-control px-2.5 py-2 font-mono text-ink-2 text-xs leading-relaxed">
              {testResult.sample}
            </pre>
          )}
        </div>
      )}
    </ConnectionRow>
  );
}
