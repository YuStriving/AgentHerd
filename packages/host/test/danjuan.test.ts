// 雪球基金 (Danjuan Funds) integration tests (ADR 0077): consent enforcement, `300001` signed-out
// detection, multi-account snapshot parsing, N-day compounded NAV gains/losses, DANJUAN_HOLDINGS MCP
// tool, and Host lifecycle wiring.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { SecretStore } from "@agentherd/core";
import { afterEach, describe, expect, it } from "vitest";
import type { HostEvent } from "../src/api.ts";
import {
  type Danjuan,
  type DanjuanBrowser,
  type DanjuanRawSnapshot,
  fetchFundNavHistory,
  formatDanjuanReport,
  normalizeHoldGainRate,
  parseDanjuanPayload,
} from "../src/danjuan.ts";
import { Host } from "../src/host.ts";

function memorySecrets(): SecretStore {
  const saved: Record<string, string> = {};
  return {
    get: (k) => saved[k],
    set: (k, v) => {
      saved[k] = v;
    },
    delete: (k) => {
      delete saved[k];
    },
  };
}

function makeSampleRaw(): {
  gain: { status: number; body: unknown };
  summaries: Record<string, { status: number; body: unknown }>;
} {
  return {
    gain: {
      status: 200,
      body: {
        result_code: 0,
        data: {
          amount: "100000.00",
          daily_gain: "850.00",
          daily_gain_date: "2026-11-18",
          hold_gain: "10000.00",
          total_gain: "12000.00",
          nick_name: "测试基民",
          items: [
            {
              summary_type: "FUND",
              amount: "100000.00",
              invest_account_list: [
                {
                  invest_account_id: "acc-1",
                  invest_account_name: "默认账户",
                  invest_account_type: "FUND",
                  market_value: "70000.00",
                  daily_gain: "600.00",
                },
                {
                  invest_account_id: "acc-2",
                  invest_account_name: "养老金组合",
                  invest_account_type: "FUND",
                  market_value: "30000.00",
                  daily_gain: "250.00",
                },
              ],
            },
          ],
        },
      },
    },
    summaries: {
      "acc-1": {
        status: 200,
        body: {
          result_code: 0,
          data: {
            invest_account_name: "默认账户",
            items: [
              {
                fd_code: "000001",
                fd_name: "华夏成长混合",
                market_value: "70000.00",
                volume: "50000",
                usable_remain_share: "50000",
                daily_gain: "600.00",
                hold_gain: "10000.00",
                hold_gain_rate: "0.1667",
                market_percent: "1.0",
              },
            ],
          },
        },
      },
      "acc-2": {
        status: 200,
        body: {
          result_code: 0,
          data: {
            invest_account_name: "养老金组合",
            items: [
              {
                fd_code: "006131",
                fd_name: "华泰柏瑞沪深300C",
                market_value: "30000.00",
                volume: "20000",
                usable_remain_share: "20000",
                daily_gain: "250.00",
                hold_gain: "3000.00",
                hold_gain_rate: "11.11",
                market_percent: "100",
              },
            ],
          },
        },
      },
    },
  };
}

class FakeDanjuanBrowser implements DanjuanBrowser {
  snapshot: DanjuanRawSnapshot = { signedOut: true, message: "请重新登录" };
  private onSignedIn: ((s: DanjuanRawSnapshot) => void) | undefined;
  private onClosed: ((reason?: string) => void) | undefined;
  cleared = 0;
  cancelled = 0;

  available(): boolean {
    return true;
  }

  async fetchGainAndSummaries(): Promise<DanjuanRawSnapshot> {
    return this.snapshot;
  }

  async openLoginWindow(
    onSignedIn: (snapshot: DanjuanRawSnapshot) => void,
    onClosed: (reason?: string) => void,
  ): Promise<void> {
    this.onSignedIn = onSignedIn;
    this.onClosed = onClosed;
  }

  completeLogin(snap: DanjuanRawSnapshot): void {
    this.snapshot = snap;
    this.onSignedIn?.(snap);
  }

  closeByUser(reason?: string): void {
    this.onClosed?.(reason);
  }

  async cancelLogin(): Promise<void> {
    this.cancelled++;
  }

  async clearSession(): Promise<void> {
    this.cleared++;
    this.snapshot = { signedOut: true };
  }

  stop(): void {}
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe("雪球基金 (Danjuan Funds, ADR 0077)", () => {
  it("detects unauthenticated 300001 responses and normalizes holdGainRate ratios vs percents", () => {
    const out = parseDanjuanPayload(
      { status: 200, body: { result_code: 300001, message: "请重新登录" } },
      {},
    );
    expect(out).toEqual({ signedOut: true, message: "请重新登录" });

    // Cost basis 60,000 + gain 10,000 => ~16.67%
    expect(normalizeHoldGainRate(0.1667, 10000, 70000)).toBeCloseTo(16.67, 2);
    // Cost basis 27,000 + gain 3,000 => ~11.11%
    expect(normalizeHoldGainRate(11.11, 3000, 30000)).toBeCloseTo(11.11, 2);

    const sample = makeSampleRaw();
    const parsed = parseDanjuanPayload(sample.gain, sample.summaries);
    expect(parsed.signedOut).toBe(false);
    if (!parsed.signedOut) {
      expect(parsed.accountLabel).toBe("测试基民");
      expect(parsed.accounts.map((a) => a.accountId)).toEqual(["acc-1", "acc-2"]);
      expect(parsed.holdings).toHaveLength(2);
      expect(parsed.holdings[0]?.holdGainRate).toBeCloseTo(16.67, 2);
      expect(parsed.holdings[1]?.holdGainRate).toBeCloseTo(11.11, 2);
    }
  });

  it("computes multi-day compounded NAV returns and reconstructs daily estimated portfolio P&L", async () => {
    const fakeFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/history/000001")) {
        return Response.json({
          result_code: 0,
          data: {
            items: [
              { date: "2026-11-18", nav: "1.4000", percentage: "2.00" },
              { date: "2026-11-17", nav: "1.3725", percentage: "-1.00" },
              { date: "2026-11-16", nav: "1.3864", percentage: "1.00" },
            ],
          },
        });
      }
      return Response.json({
        result_code: 0,
        data: {
          items: [
            { date: "2026-11-18", nav: "1.5000", percentage: "1.00" },
            { date: "2026-11-17", nav: "1.4851", percentage: "1.00" },
          ],
        },
      });
    }) as typeof fetch;

    const nav1 = await fetchFundNavHistory("000001", 3, fakeFetch);
    expect(nav1?.days.map((d) => d.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    // 1.01 * 0.99 * 1.02 - 1 = 0.019898 -> 1.9898%
    expect(nav1?.cumulativePct).toBeCloseTo(1.9898, 3);

    const sample = makeSampleRaw();
    const snap = parseDanjuanPayload(sample.gain, sample.summaries);
    expect(snap.signedOut).toBe(false);
    if (!snap.signedOut && nav1 !== undefined) {
      const nav2 = await fetchFundNavHistory("006131", 3, fakeFetch);
      const map = new Map([["000001", nav1], ...(nav2 ? [["006131", nav2] as const] : [])]);
      const report = formatDanjuanReport(snap, map, 3);
      expect(report).toContain("总资产 100000.00元");
      expect(report).toContain("华夏成长混合 (000001)");
      expect(report).toContain("[默认账户] 华夏成长混合");
      expect(report).toContain("[养老金组合] 华泰柏瑞沪深300C");
      expect(report).toContain("近3日 +1.99%");
      expect(report).toContain("11-16 +1.00% · 11-17 -1.00% · 11-18 +2.00%");
      expect(report).toContain("2026-11-18:");
      expect(report).toContain("仅供参考，不构成投资建议");
    }
  });

  it("enforces risk notice consent, completes interactive login, exposes DANJUAN_HOLDINGS MCP, and logs out via Host", async () => {
    const home = mkdtempSync(join(tmpdir(), "danjuan-host-"));
    const browser = new FakeDanjuanBrowser();
    const events: HostEvent[] = [];

    const fakeFetch = (async () =>
      Response.json({
        result_code: 0,
        data: {
          items: [
            { date: "2026-11-18", nav: "1.4000", percentage: "1.20" },
            { date: "2026-11-17", nav: "1.3834", percentage: "0.80" },
          ],
        },
      })) as typeof fetch;

    const host = new Host({
      home,
      userHome: home,
      secrets: memorySecrets(),
      fetch: fakeFetch,
      danjuanBrowser: browser,
      profiles: () => [{ id: "mock", name: "Mock", command: ["mock"], env: {}, exporter: null }],
      createChannel: () => new FakeChannel(),
    });
    host.onEvent((e) => events.push(e));
    cleanups.push(() => host.stop());
    await host.start();

    expect((await host.danjuan()).state).toBe("off");
    await expect(host.connectDanjuan(false)).rejects.toThrow(/确认只读风险提示/);

    const signingIn = await host.connectDanjuan(true);
    expect(signingIn.state).toBe("signing-in");
    expect(signingIn.accepted).toBe(true);

    const sample = makeSampleRaw();
    const readySnap = parseDanjuanPayload(sample.gain, sample.summaries);
    browser.completeLogin(readySnap);

    const afterLogin = events.filter((e) => e.topic === "danjuan").at(-1);
    expect(afterLogin?.topic === "danjuan" && afterLogin.data.state).toBe("ready");
    expect(afterLogin?.topic === "danjuan" && afterLogin.data.account).toBe("测试基民");

    const testRes = await host.testDanjuan();
    expect(testRes.ok).toBe(true);
    expect(testRes.message).toContain("共 2 只持仓基金");
    expect(testRes.sample).toContain("近 5 个交易日估算汇总");

    // Verify toolNotes and readOnly DANJUAN_HOLDINGS MCP tool via standalone Danjuan wrapper too.
    const internal = host as unknown as {
      danjuanCli: Danjuan;
      toolNotes(): string[];
    };
    expect(internal.toolNotes().some((n) => n.includes("DANJUAN_HOLDINGS"))).toBe(true);
    const tools = internal.danjuanCli.tools();
    expect(await tools.list()).toHaveLength(1);
    const desc = await tools.describe(["DANJUAN_HOLDINGS"]);
    expect(desc.get("DANJUAN_HOLDINGS")?.hints).toEqual({
      readOnly: true,
      create: false,
      update: false,
      destructive: false,
    });
    const mcpAns = (await tools.call("DANJUAN_HOLDINGS", { days: 2, account: "默认" })) as {
      content: { text: string }[];
    };
    expect(mcpAns.content[0]?.text).toContain("华夏成长混合");
    expect(mcpAns.content[0]?.text).not.toContain("华泰柏瑞沪深300C");

    // Simulate expired session mid-run (`300001`).
    browser.snapshot = { signedOut: true, message: "请重新登录" };
    const expiredMsg = await internal.danjuanCli.holdings();
    expect(expiredMsg).toContain("登录已失效");
    expect((await host.danjuan()).state).toBe("signed-out");

    const loggedOut = await host.logoutDanjuan();
    expect(loggedOut.state).toBe("off");
    expect(browser.cleared).toBe(1);
    expect(await tools.list()).toEqual([]);
  });
});
