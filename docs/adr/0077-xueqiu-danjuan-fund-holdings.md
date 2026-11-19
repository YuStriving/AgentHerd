# 0077. 雪球基金 (Danjuan Funds) personal holdings and recent NAV changes

- Date: 2026-11-19
- Status: Accepted

## Context

The owner holds mutual funds through 雪球基金 (Danjuan Funds, `danjuanfunds.com`) and wants AgentHerd to check personal holdings, total assets, daily gains, and the past several trading days' returns directly in conversation.

Xueqiu's main website (`xueqiu.com`) has no official OpenAPI for individual investor accounts or Chinese A-share broker positions. However, Danjuan Funds serves personal sub-accounts and fund holdings through authenticated endpoints on `danjuanfunds.com` (`/djapi/fundx/profit/assets/gain`, `/djapi/fundx/profit/assets/summary`), and publishes public per-fund historical NAV data (`/djapi/fund/nav/history/<fd_code>`). External community CLI wrappers require running third-party browser bridge extensions on top of the owner's primary browser.

## Decision

Integrate **雪球基金 (`danjuanfunds.com`)** natively via AgentHerd's isolated Chrome/Edge CDP browser session (`packages/host/src/danjuan.ts`), strictly **read-only**:

1. **Isolated local interactive sign-in & cookie storage.**
   - `Chrome.start({ headless: false, url })` in `packages/host/src/cdp.ts` opens a dedicated `--app` login window backed by an isolated profile (`<home>/danjuan/profile`), leaving the owner's personal Chrome profile untouched.
   - Before opening the login window for the first time, the UI (`DanjuanSection.tsx`) requires explicit confirmation of the read-only local-session notice (`connectDanjuan(accepted)`).
   - Once login redirects off `/account/login` and authenticated endpoints succeed, `Chrome.closeGracefully()` sends `Browser.close` so Chromium flushes SQLite cookies to disk before closing. Subsequent portfolio reads reuse a short-lived headless Chrome (auto-closed after 3 minutes idle).
2. **Read-only portfolio + recent N-day NAV attribution.**
   - `Danjuan.holdings({ days, account })` fetches personal sub-accounts and per-fund holdings (checking HTTP `401` / `result_code === 300001` as `signed-out`), normalizes `hold_gain_rate`, fetches public `days`-day dividend-adjusted NAV history per fund concurrently, and reconstructs backwards daily estimated P&L across the recent `days` trading dates from current holding market values.
   - Never exposes or invokes fund subscription, redemption, or transfer endpoints.
3. **Herder and MCP exposure.**
   - The Herder gets `fund_holdings` directly (excluded from `acted` side-effect checks alongside `stock_quote`) so questions about personal fund returns resolve in one turn without spinning up a task.
   - Coding and research tasks get the read-only `DANJUAN_HOLDINGS` MCP tool (`readOnly: true`) and a concise status note in `toolNotes()` when connected.

## Consequences

- The owner only needs one SMS/password login in the isolated browser window; AgentHerd never reads or stores SMS codes or passwords.
- Because `danjuanfunds.com` uses non-public web APIs, endpoint changes or upstream session expiry surface cleanly as `signed-out` / `failed` with inline re-login controls in 设置 › 应用连接 › 行情与投研 › 雪球基金.
- Estimated multi-day CNY P&L is computed statically from current fund positions and explicitly states that intra-period subscriptions/redemptions are excluded and market data is for reference only.
