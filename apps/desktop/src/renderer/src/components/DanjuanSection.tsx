// 应用连接 › 行情与投研 › 雪球基金 (ADR 0077): local isolated Chrome/Edge window sign-in for
// `danjuanfunds.com` so the Herder and task agents can inspect personal fund holdings and recent
// N-day NAV gains/losses (strictly read-only; credentials stay on this computer).

import type { DanjuanTest, DanjuanView } from "@agentherd/host/api";
import { Activity, Link2, Loader2, LogOut, PieChart, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText, host, useApp } from "../store";
import { ConnectionRow, RowActions, subtitle, type Tested } from "./ConnectionRow";
import { Modal } from "./Modal";
import { Badge, Button, IconTile } from "./ui";

const READ_ABILITIES = ["查个人基金总资产与持仓明细", "算近 N 日每日净值涨跌与区间盈亏"] as const;

function stateBadge(danjuan: DanjuanView | undefined) {
  if (danjuan === undefined) return <Badge>检查中…</Badge>;
  if (!danjuan.available) return <Badge>需 Chrome / Edge</Badge>;
  switch (danjuan.state) {
    case "ready":
      return (
        <Badge tone="green">
          已连接{danjuan.account !== undefined ? ` · ${danjuan.account}` : ""}
        </Badge>
      );
    case "signing-in":
      return <Badge tone="blue">等待登录…</Badge>;
    case "starting":
      return <Badge tone="blue">连接中…</Badge>;
    case "signed-out":
      return <Badge tone="amber">登录失效</Badge>;
    case "failed":
      return <Badge tone="red">出错</Badge>;
    case "off":
      return <Badge>未连接</Badge>;
  }
}

function ConnectDialog({ danjuan, onClose }: { danjuan: DanjuanView; onClose: () => void }) {
  const [phase, setPhase] = useState<"notice" | "waiting" | "failed">(
    danjuan.accepted ? "waiting" : "notice",
  );
  const [ticked, setTicked] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const started = useRef(false);

  const startLogin = useCallback(async () => {
    setPhase("waiting");
    setProblem(undefined);
    try {
      const next = await host().connectDanjuan(true);
      useApp.setState({ danjuan: next });
      if (next.state === "failed") {
        setProblem(next.problem);
        setPhase("failed");
      }
    } catch (error) {
      setProblem(errorText(error));
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    if (phase === "waiting" && !started.current) {
      started.current = true;
      void startLogin();
    }
  }, [phase, startLogin]);

  useEffect(() => {
    if (danjuan.state === "ready" && phase !== "notice") onClose();
  }, [danjuan.state, phase, onClose]);

  const cancel = async () => {
    const next = await call((h) => h.cancelDanjuanLogin());
    if (next !== undefined) useApp.setState({ danjuan: next });
    onClose();
  };

  if (phase === "notice") {
    return (
      <Modal
        title="连接雪球基金"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>取消</Button>
            <Button
              variant="primary"
              disabled={!ticked}
              onClick={() => {
                started.current = true;
                void startLogin();
              }}
            >
              打开登录窗口
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-ink-2 text-md leading-6">
            AgentHerd 会打开一个本机独立浏览器窗口访问雪球基金网页版（danjuanfunds.com）。
            账号登录态仅保存在你自己的电脑本地目录中；Agent
            只会调用只读接口查看你的基金持仓、累计收益与净值历史，绝不触碰申购、赎回或转账操作。
            注意这通过浏览器会话实现，不属于雪球官方 OpenAPI。
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-ink text-md">
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            我已了解并仅用于只读查询
          </label>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="连接雪球基金"
      onClose={() => void cancel()}
      footer={
        phase === "waiting" ? (
          <Button onClick={() => void cancel()}>取消</Button>
        ) : (
          <Button onClick={onClose}>关闭</Button>
        )
      }
    >
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 pb-2 text-center">
        {phase === "waiting" && (
          <>
            <Loader2 size={22} className="animate-spin text-ink-muted" />
            <p className="text-ink text-md">已在独立浏览器窗口打开雪球基金登录页</p>
            <p className="text-ink-muted text-sm leading-6">
              请在弹出的窗口中完成短信验证码或密码登录；跳转到资产页后，窗口会自动收起并保存本机登录态。
            </p>
          </>
        )}
        {phase === "failed" && (
          <>
            <p className="text-danger-text text-md">没有连上{problem ? `：${problem}` : ""}</p>
            <Button
              variant="primary"
              onClick={() => {
                started.current = true;
                void startLogin();
              }}
            >
              再试一次
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function DanjuanRow() {
  const danjuan = useApp((s) => s.danjuan);
  const [busy, setBusy] = useState<"test" | "logout" | "cancel">();
  const [tested, setTested] = useState<Tested>();
  const [testResult, setTestResult] = useState<DanjuanTest>();
  const [connecting, setConnecting] = useState(false);

  const ready = danjuan?.state === "ready";
  const closeDialog = useCallback(() => setConnecting(false), []);

  const runTest = async () => {
    setBusy("test");
    setTested(undefined);
    setTestResult(undefined);
    try {
      const res = await call((h) => h.testDanjuan());
      if (res !== undefined) {
        useApp.setState({ danjuan: res.danjuan });
        setTested({ ok: res.ok, message: res.message });
        setTestResult(res);
      }
    } finally {
      setBusy(undefined);
    }
  };

  const logout = async () => {
    setBusy("logout");
    setTested(undefined);
    setTestResult(undefined);
    try {
      const next = await call((h) => h.logoutDanjuan());
      if (next !== undefined) useApp.setState({ danjuan: next });
    } finally {
      setBusy(undefined);
    }
  };

  const rowAction =
    danjuan === undefined || !danjuan.available ? undefined : ready ? (
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== undefined}
        onClick={() => void runTest()}
      >
        {busy === "test" ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
        测试连接
      </Button>
    ) : (
      <Button size="sm" disabled={busy !== undefined} onClick={() => setConnecting(true)}>
        <Link2 size={12} />
        {danjuan.state === "signed-out" ? "重连" : "连接"}
      </Button>
    );

  return (
    <ConnectionRow
      icon={
        <IconTile tone={ready ? "green" : "gray"}>
          <PieChart size={14} />
        </IconTile>
      }
      name="雪球基金"
      badge={stateBadge(danjuan)}
      subtitle={
        subtitle(danjuan?.state === "failed" ? danjuan.problem : undefined, tested) ??
        "查看个人基金持仓（原蛋卷基金）与近几日涨跌"
      }
      action={rowAction}
      alert={danjuan?.state === "failed"}
      dialog={
        connecting &&
        danjuan !== undefined && <ConnectDialog danjuan={danjuan} onClose={closeDialog} />
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-ink-muted text-xs">直接做</span>
        {READ_ABILITIES.map((r) => (
          <Badge key={r}>{r}</Badge>
        ))}
      </div>

      {danjuan?.available && (ready || danjuan.enabled) && (
        <RowActions>
          {ready && (
            <Button size="sm" disabled={busy !== undefined} onClick={() => void runTest()}>
              {busy === "test" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Activity size={12} />
              )}
              测试连接
            </Button>
          )}
          <Button size="sm" disabled={busy !== undefined} onClick={() => setConnecting(true)}>
            <RefreshCw size={12} />
            重新登录
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== undefined}
            onClick={() => void logout()}
          >
            {busy === "logout" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <LogOut size={12} />
            )}
            退出登录
          </Button>
        </RowActions>
      )}

      {testResult?.sample !== undefined && (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-control px-2.5 py-2 font-mono text-ink-2 text-xs leading-relaxed">
          {testResult.sample}
        </pre>
      )}
    </ConnectionRow>
  );
}
