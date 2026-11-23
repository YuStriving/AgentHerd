// Sample data for the in-memory dev bridge (dev-bridge.ts): a placeholder QR code,
// tasks, model services, the provider catalog, the Herder's schedules,
// and the platforms, 飞书, news sources and watches of 应用连接.

import type {
  FeedView,
  HerderActivityView,
  HerderContextView,
  HerderMessageView,
  LarkView,
  MailboxLetterView,
  MailboxSourceView,
  MailboxView,
  MemoryView,
  ModelsView,
  ProviderView,
  SocialView,
  SubscriptionView,
  TasksView,
  TranscriptView,
  WatchView,
} from "@agentherd/host/api";

export const PLACEHOLDER_QR = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges">
<rect width="21" height="21" fill="#fff"/>
<path fill="#000" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM9 1h2v2H9zM8 4h3v2H8zM9 8h3v3H9zM13 9h2v2h-2zM16 9h3v2h-3zM8 13h2v3H8zM11 14h3v2h-3zM15 13h2v2h-2zM17 16h3v3h-3zM12 18h3v2h-3zM9 18h2v3H9z"/>
</svg>`,
)}`;

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

const OPENROUTER_MODELS: readonly (readonly [string, string])[] = [
  ["anthropic/claude-sonnet-4.5", "Anthropic: Claude Sonnet 4.5"],
  ["anthropic/claude-opus-4.1", "Anthropic: Claude Opus 4.1"],
  ["anthropic/claude-haiku-4.5", "Anthropic: Claude Haiku 4.5"],
  ["openai/gpt-5", "OpenAI: GPT-5"],
  ["openai/gpt-5-mini", "OpenAI: GPT-5 mini"],
  ["openai/gpt-5-codex", "OpenAI: GPT-5 Codex"],
  ["openai/gpt-oss-120b", "OpenAI: gpt-oss-120b"],
  ["google/gemini-2.5-pro", "Google: Gemini 2.5 Pro"],
  ["google/gemini-2.5-flash", "Google: Gemini 2.5 Flash"],
  ["google/gemini-2.5-flash-lite", "Google: Gemini 2.5 Flash Lite"],
  ["deepseek/deepseek-chat-v3.1", "DeepSeek: DeepSeek V3.1"],
  ["deepseek/deepseek-r1-0528", "DeepSeek: R1 0528"],
  ["qwen/qwen3-coder", "Qwen: Qwen3 Coder"],
  ["qwen/qwen3-max", "Qwen: Qwen3 Max"],
  ["qwen/qwen3-235b-a22b-2507", "Qwen: Qwen3 235B A22B 2507"],
  ["moonshotai/kimi-k2-0905", "MoonshotAI: Kimi K2 0905"],
  ["z-ai/glm-4.6", "Z.AI: GLM 4.6"],
  ["z-ai/glm-4.5-air", "Z.AI: GLM 4.5 Air"],
  ["x-ai/grok-4", "xAI: Grok 4"],
  ["x-ai/grok-code-fast-1", "xAI: Grok Code Fast 1"],
  ["mistralai/devstral-medium", "Mistral: Devstral Medium"],
  ["mistralai/mistral-medium-3.1", "Mistral: Mistral Medium 3.1"],
  ["meta-llama/llama-4-maverick", "Meta: Llama 4 Maverick"],
  ["minimax/minimax-m2", "MiniMax: MiniMax M2"],
];

const task = (
  id: string,
  title: string,
  project: string,
  stage: TasksView["tasks"][number]["stage"],
  lastReport: string,
  updated: number,
): TasksView["tasks"][number] => ({
  id,
  title,
  project,
  agent: "pi",
  stage,
  lastReport,
  startedAt: minutesAgo(updated + 30),
  updatedAt: minutesAgo(updated),
  automaticDecisions: [],
});

/** The sample tasks and approval items; none for the empty states. */
/** A sample conversation for the task view (`?open=task-<id>`). */
export function sampleTranscript(taskId: string): TranscriptView {
  const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  if (taskId !== "s2") return { entries: [], live: "" };
  return {
    entries: [
      {
        id: 1,
        at: at(9),
        role: "prompt",
        text: [
          "[Owner's message]",
          "给订单服务补单元测试，重点覆盖退款和部分发货。",
          "",
          "[Context added by the Herder, for reference]",
          "测试放在 test/orders 下，用现有的 vitest 配置；不要改业务代码。",
          "",
          "过去类似任务的记录（仅供参考）：",
          "- [经验] 改测试前先跑一遍现有测试，确认基线是绿的。",
        ].join("\n"),
      },
      { id: 2, at: at(9), role: "agent", text: "我先看一下订单服务的结构和现有测试。" },
      {
        id: 3,
        at: at(9),
        role: "tool",
        text: "cd /Users/me/.agentherd/worktrees/order-service-1d9a25/s2 && ls src/orders test",
        status: "completed",
      },
      {
        id: 31,
        at: at(9),
        role: "tool",
        text: "cd /Users/me/.agentherd/worktrees/order-service-1d9a25/s2 && git log --oneline -5 -- src/orders",
        status: "completed",
      },
      {
        id: 32,
        at: at(9),
        role: "tool",
        text: [
          "cd /Users/me/.agentherd/worktrees/order-service-1d9a25/s2 && python3 - <<'EOF'",
          "import json",
          "cases = json.load(open('test/fixtures/orders.json'))",
          "print(len([c for c in cases if c['refund']]))",
          "EOF",
        ].join("\n"),
        status: "completed",
      },
      { id: 4, at: at(8), role: "tool", text: "Read src/orders/refund.ts", status: "completed" },
      {
        id: 5,
        at: at(6),
        role: "agent",
        text: [
          "## 退款逻辑",
          "",
          "`refund()` 有三条分支，我按这三条各写测试，再补**部分发货**：",
          "",
          "1. 全额退款",
          "2. 部分退款",
          "   - 金额不能超过已付",
          "3. 超过 *30 天*：拒绝",
          "",
          "| 分支 | 测试 |",
          "| --- | --: |",
          "| 全额 | 3 |",
          "| 部分 | 5 |",
          "",
          "```ts",
          "expect(refund(order, 100)).toEqual({ ok: true });",
          "```",
          "",
          "> 部分发货的规则见 [文档](https://example.com/orders)。",
        ].join("\n"),
      },
      {
        id: 6,
        at: at(5),
        role: "tool",
        text: "Write test/orders/refund.test.ts",
        status: "completed",
      },
      { id: 7, at: at(3), role: "tool", text: "npm test", status: "completed" },
      {
        id: 8,
        at: at(3),
        role: "agent",
        text: "12 个测试都过了：退款 8 个，部分发货 4 个。测试在 test/orders/refund.test.ts。",
      },
      {
        id: 9,
        at: at(2),
        role: "prompt",
        text: "[Message from the Herder, not from the owner]\n负责人想再加几个超过 30 天退款的边界测试。",
      },
      { id: 10, at: at(1), role: "tool", text: "npm test -- refund", status: "in_progress" },
    ],
    live: "已写完 12 个测试，正在跑 npm test",
  };
}

export function sampleTasks(empty: boolean): TasksView {
  return empty
    ? { tasks: [], items: [] }
    : {
        tasks: [
          task(
            "s1",
            "修复登录页在 Safari 上的白屏",
            "web-portal",
            "needs-owner",
            "修好了，想发一个 next 版本验证，等你批准",
            3,
          ),
          task(
            "s2",
            "给订单服务补单元测试",
            "order-service",
            "working",
            "已写完 12 个测试，正在跑 npm test",
            1,
          ),
          task("s3", "把日志库换成 pino", "order-service", "queued", "", 6),
          task("s4", "升级 Node 到 24", "infra", "stuck", "CI 里的镜像拉不下来，已经重试 3 次", 18),
          task("s5", "整理 README 的安装步骤", "web-portal", "done", "已提交 PR #128", 55),
          task("s6", "迁移旧的用户表", "order-service", "failed", "迁移脚本报错：外键冲突", 120),
          task("s7", "给首页加骨架屏", "web-portal", "done", "已提交 PR #127", 240),
        ],
        items: [
          {
            id: "i1",
            sessionId: "s1",
            title: "执行命令",
            body: "npm publish --access public --tag next ./packages/web-portal",
            risk: "high",
            createdAt: minutesAgo(3),
            cwd: "/Users/me/code/web-portal",
            profileId: "codex",
            taskTitle: "修复登录页在 Safari 上的白屏",
          },
          {
            id: "i2",
            sessionId: "s0",
            title: "写入文件",
            body: "~/.npmrc: registry=https://npm.example.com/",
            risk: "medium",
            createdAt: minutesAgo(9),
            cwd: "/Users/me/code/scratch",
            profileId: "codex",
          },
        ],
      };
}

/** The sample model services. */
export function sampleServices(): ModelsView["services"] {
  return [
    {
      id: "deepseek",
      name: "DeepSeek",
      kind: "builtin",
      provider: "deepseek",
      models: ["deepseek-chat", "deepseek-reasoner"],
      hasKey: true,
    },
    {
      id: "gateway",
      name: "公司网关",
      kind: "openai-compatible",
      baseUrl: "https://llm.example.com/v1",
      models: ["qwen3-coder-plus", "glm-4.6", "deepseek-chat"],
      hasKey: false,
    },
  ];
}

/** Vendors of 用订阅登录, a few from pi-ai's list (ADR 0068). */
export const SAMPLE_SUBSCRIPTIONS: SubscriptionView[] = [
  {
    provider: "openai-codex",
    name: "OpenAI (ChatGPT Plus/Pro)",
    subscription: true,
    models: ["gpt-6-astra", "gpt-5.6-codex", "gpt-5.6-mini"].map((id) => ({ id, name: id })),
  },
  {
    provider: "anthropic",
    name: "Anthropic (Claude Pro/Max)",
    subscription: true,
    models: ["claude-opus-5-5", "claude-sonnet-5-5"].map((id) => ({ id, name: id })),
  },
  {
    provider: "github-copilot",
    name: "GitHub Copilot",
    subscription: true,
    models: ["claude-sonnet-5-5", "gpt-6.1-sol", "gemini-3-pro"].map((id) => ({ id, name: id })),
  },
  {
    provider: "kimi-coding",
    name: "Kimi Code",
    subscription: true,
    models: ["kimi-k2.6"].map((id) => ({ id, name: id })),
  },
  {
    provider: "xai",
    name: "xAI (SuperGrok / X Premium)",
    subscription: true,
    models: ["grok-5"].map((id) => ({ id, name: id })),
  },
  {
    provider: "openrouter",
    name: "OpenRouter OAuth",
    subscription: false,
    models: ["openai/gpt-6.1-sol", "qwen/qwen3-coder"].map((id) => ({ id, name: id })),
  },
];

export const providers: ProviderView[] = [
  {
    provider: "deepseek",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
  },
  {
    provider: "anthropic",
    models: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-1", name: "Claude Opus 4.1" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ],
  },
  {
    provider: "openai",
    models: [
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-mini", name: "GPT-5 mini" },
    ],
  },
  {
    provider: "google",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
  {
    provider: "openrouter",
    // Many models, so the model panes can be seen scrolling.
    models: OPENROUTER_MODELS.map(([id, name]) => ({ id, name })),
  },
];

type MemoryEntry = MemoryView["entries"][number];

function mem(
  id: string,
  kind: MemoryEntry["kind"],
  abstract: string,
  extra: Partial<MemoryEntry> = {},
): MemoryEntry {
  return {
    id,
    kind,
    scope: "global",
    abstract,
    body: "",
    source: "said",
    status: "active",
    accessCount: 0,
    rev: 1,
    createdAt: "2026-11-05T10:00:00.000Z",
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...extra,
  };
}

/** What the 记忆 page shows in the browser preview. */
export function sampleMemory(): MemoryView {
  return {
    ready: true,
    used: { profile: 38, owner: 31, decision: 22, note: 18 },
    caps: { profile: 600, owner: 1375, decision: 2200, note: 2200 },
    entries: [
      mem("p0", "profile", "称呼：火哥", { source: "owner_edit" }),
      mem("p1", "profile", "在做：AgentHerd，一个帮人盯着编程 agent 的桌面应用", {
        source: "review",
        evidence: "我在做 AgentHerd",
      }),
      mem("p2", "profile", "作息：常写代码到半夜", {
        source: "review",
        evidence: "我一般半夜还在写代码",
      }),
      mem("m0", "decision", "AgentHerd 仓库的改动可以直接推 main，不用开 PR", {
        evidence: "AgentHerd 以后直接推 main 就行，不用开 PR",
      }),
      mem("m1", "owner", "回复用中文，先说结论，别太长", {
        evidence: "以后都用中文回复，先说结论",
        accessCount: 12,
      }),
      mem("m2", "owner", "提交 PR 前先跑测试", { evidence: "每次提 PR 前都要先跑测试" }),
      mem("m3", "note", "这台 Mac 上 Codex 启动会被杀掉，用 Pi", {
        source: "noticed",
        until: "2026-12-31",
      }),
      mem("m4", "person", "小王负责 pi-desktop 的打包和发布", {
        evidence: "小王管 pi-desktop 打包",
      }),
      mem("m5", "project", "pi-desktop 是 Pi 的桌面版，Electron + React", {
        scope: "project:/Users/me/learn-agent/pi-desktop",
      }),
      mem("m6", "experience", "梳理开源仓库 issue 时先按标签和最近更新筛，再看能不能复现", {
        source: "task",
        body: "适用于「看看有哪些 issue 可以做」一类任务。\n来自案例 c1a2b3c4",
        accessCount: 2,
      }),
      mem("m7", "case", "pi-desktop：梳理可做的 issue，挑出 5 个，已写进 issues.md", {
        source: "task",
        scope: "project:/Users/me/learn-agent/pi-desktop",
        body: "结果：done（issues.md 已提交）\n做法：gh issue list --label good-first-issue\n教训：先确认项目目录，别写到临时目录",
      }),
    ],
    deleted: [mem("m8", "owner", "用英文写提交信息", { status: "deleted" })],
  };
}

/** An ISO time some hours from now, so a preview's 下次 times look right. */
export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** The platforms in the browser preview: 小红书 signed in with mentions on, 知乎 not connected. */
export function sampleSocials(): SocialView[] {
  return [
    {
      platform: "xiaohongshu",
      name: "小红书",
      available: true,
      accepted: true,
      enabled: true,
      state: "ready",
      account: "小羊不吃草",
      watch: { mentions: true, likes: false, follows: false },
      checkedAt: hoursFromNow(-0.2),
    },
    {
      platform: "zhihu",
      name: "知乎",
      available: true,
      accepted: false,
      enabled: false,
      state: "off",
      watch: { mentions: true, likes: false, follows: false },
    },
  ];
}

/** The tasks' pull requests in the browser preview (ADR 0100); `empty` has none. */
export function sampleWatches(empty: boolean): WatchView[] {
  if (empty) return [];
  return [
    {
      id: "pr:zszz3/AgentHerd#212",
      kind: "pr",
      title: "AgentHerd #212 小红书接入",
      detail: "CI、评审和合并，每 5 分钟看一次",
      paused: false,
      removable: true,
      createdAt: hoursFromNow(-30),
      activeAt: hoursFromNow(-0.3),
    },
  ];
}

/** 飞书 in the browser preview: signed in, or not installed yet for `?sim=empty`. */
export function sampleLark(empty: boolean): LarkView {
  return empty
    ? { state: "missing" }
    : { state: "ready", account: "小羊", version: "1.4.0", checkedAt: hoursFromNow(-0.1) };
}

/** The news sources in the browser preview: Trending and Hacker News on, arXiv off. */
export function sampleFeeds(): FeedView[] {
  return [
    { source: "github-trending", name: "GitHub Trending", on: true },
    { source: "hacker-news", name: "Hacker News", on: true },
    { source: "arxiv", name: "arXiv", on: false },
  ];
}

/** The Herder's action log for 主管 › 行动记录, from a real night of finding issues. */
export function sampleHerderActivity(): HerderActivityView {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  return {
    total: 4,
    turns: [
      {
        at: at(3),
        trigger: "owner",
        text: "哪九个，你跟我说一下分别问题是啥",
        events: [],
        resumed: false,
        steps: [
          {
            tool: "session_prompt",
            args: { task: "d8fb0f19", text: "每个 issue 用一两句说清要解决什么" },
            result: "sent to d8fb0f19",
            error: false,
            ms: 12,
          },
        ],
        reply: "已让 agent 逐个写清楚，每条一两句，出来我就发你。",
        quiet: false,
        model: "deepseek-flash",
      },
      {
        at: at(7),
        trigger: "task",
        text: "pi-desktop：复查可做的 issue",
        events: [],
        resumed: false,
        steps: [],
        reply:
          "上次那 9 个都没变化，仍可做；新查出来 2 个：#2226 内置浏览器加静音按钮，#2220 Windows 下路径带空格打不开。",
        quiet: false,
        model: "deepseek-flash",
      },
      {
        at: at(16),
        trigger: "answer",
        text: "/Users/me/learnspace/PI-Desktop",
        question: "再选一次具体路径，我就开任务（两个同名项目）",
        events: [],
        resumed: false,
        steps: [
          {
            tool: "session_start",
            args: {
              project: "/Users/me/learnspace/PI-Desktop",
              profile: "pi",
              model: "deepseek/deepseek-flash",
              name: "pi-desktop：复查可做的 issue",
            },
            result:
              "started task d8fb0f19 in /Users/me/learnspace/PI-Desktop with pi, deepseek/deepseek-flash.",
            error: false,
            ms: 410,
          },
        ],
        reply:
          "已在 learnspace/PI-Desktop 开跑了（模型 deepseek-flash），复查上次那 9 个，再找新的。",
        quiet: false,
        model: "deepseek-flash",
      },
      {
        at: at(19),
        trigger: "answer",
        text: "PI-Desktop（learnspace 里那个）",
        question: "有两个叫 PI-Desktop 的项目，用哪个？",
        events: [],
        resumed: false,
        steps: [
          {
            tool: "session_start",
            args: { project: "PI-Desktop", profile: "pi" },
            result:
              "the owner did not pick /Users/me/learnspace/PI-Desktop in this message; call project_find and ask the owner to pick the folder",
            error: true,
            ms: 3,
          },
          {
            tool: "project_find",
            args: { query: "PI-Desktop" },
            result: "/Users/me/learnspace/PI-Desktop\n/Users/me/work/PI-Desktop",
            error: false,
            ms: 85,
          },
          {
            tool: "ask",
            args: { question: "再选一次具体路径，我就开任务（两个同名项目）" },
            result: "asked",
            error: false,
            ms: 20,
          },
        ],
        reply: "",
        quiet: false,
        model: "deepseek-flash",
      },
    ],
    incidents: [
      {
        at: at(5),
        kind: "herder.retry",
        data: { kind: "owner", message: "Connection error.", delay: 2000 },
      },
    ],
  };
}

/** A Herder that has talked a week, folded three times and once folded two folds into one. */
/** `choice` is the owner's working window (ADR 0097); the sample model allows 1M. */
export function sampleHerderContext(choice = 128_000): HerderContextView {
  const modelWindow = 1_000_000;
  const window = choice > 0 ? Math.min(choice, modelWindow) : modelWindow;
  const now = Date.now();
  const HOUR = 3_600_000;
  const start = now - 6 * 24 * HOUR;
  /** Message `seq` is spread over the six days. */
  const atOf = (seq: number) => new Date(start + (seq / 300) * 6 * 24 * HOUR).toISOString();
  const parts = {
    system: 9_000,
    tools: 7_500,
    memory: 300,
    folds: 6_300,
    owner: 9_800,
    herder: 18_600,
    results: 26_400,
  };
  const item = (part: keyof typeof parts, label: string, tokens: number, text: string) => ({
    part,
    label,
    tokens,
    text,
    more: 0,
  });
  const fold = (
    blockId: string,
    startSeq: number,
    endSeq: number,
    extra: Partial<HerderContextView["folds"][number]>,
  ): HerderContextView["folds"][number] => ({
    blockId,
    children: [],
    level: 1,
    state: "active",
    by: "herder",
    summary:
      "- 主人让我整理 PI-Desktop 的 issue，挑了 8 个能做的\n- 小红书面馆那件事已经办完\n- 没有要跟进的",
    startSeq,
    endSeq,
    messages: endSeq - startSeq + 1,
    rounds: Math.round((endSeq - startSeq + 1) / 5),
    kinds: { owner: 12, task: 3, reply: 20, call: 18, result: 18 },
    startAt: atOf(startSeq),
    endAt: atOf(endSeq),
    summaryAt: "note",
    tokensBefore: (endSeq - startSeq + 1) * 360,
    tokensAfter: 2_400,
    createdAt: atOf(endSeq + 6),
    ...extra,
  });
  const folds = [
    fold("b1", 0, 80, {
      topic: "早期杂务：PI-Desktop issue、小红书面馆",
      state: "merged",
      parent: "b4",
      summaryAt: "parent",
    }),
    fold("b2", 81, 150, {
      topic: "飞书邮箱授权和 GitHub Trending",
      state: "merged",
      parent: "b4",
      summaryAt: "parent",
      by: "forced",
    }),
    fold("b4", 0, 150, {
      topic: "11 月上半的事",
      level: 2,
      children: ["b1", "b2"],
      tokensBefore: 54_000,
      tokensAfter: 3_100,
      callSeq: 212,
      summaryAt: "call",
      createdAt: atOf(213),
    }),
    fold("b3", 151, 190, {
      topic: "调研 Agent 搜索方案",
      callSeq: 231,
      summaryAt: "call",
      createdAt: atOf(232),
    }),
  ];
  const ROUND_KINDS = ["owner", "owner", "task", "owner", "event"];
  const TITLES = [
    "整理三月的发票",
    "看看今天腾讯和快手",
    "「查最近的未读邮件」做完了",
    "小红书面馆再找几家",
    "新邮件 2 封",
  ];
  const rounds = Array.from({ length: 60 }, (_, i) => {
    const seq = i * 5;
    const inner = folds
      .filter((f) => f.state !== "opened" && seq >= f.startSeq && seq <= f.endSeq)
      .sort((a, b) => a.level - b.level)[0];
    return {
      seq,
      endSeq: seq + 4,
      at: atOf(seq),
      kind: ROUND_KINDS[i % 5] ?? "owner",
      title: TITLES[i % 5] ?? "",
      messages: 5,
      tokens: 1_200 + (i % 7) * 400,
      ...(inner === undefined ? {} : { fold: inner.blockId }),
    };
  });
  const requests = Array.from({ length: 140 }, (_, i) => {
    const seq = Math.round((i / 140) * 300);
    const grown = seq < 213 ? 20_000 + seq * 300 : 30_000 + (seq - 213) * 600;
    const at = atOf(seq);
    return {
      at,
      model: "deepseek/deepseek-flash",
      tokens: grown,
      input: Math.round(grown * (i % 9 === 0 ? 0.6 : 0.08)),
      output: 300 + (i % 7) * 90,
      cacheRead: Math.round(grown * (i % 9 === 0 ? 0.4 : 0.92)),
      cacheWrite: 0,
      cost: grown * 0.00000003,
      seq,
      round: seq - (seq % 5),
      ...(i === 77 ? { failed: true } : {}),
    };
  });
  const byDay = new Map<string, HerderContextView["days"][number]>();
  for (const r of requests) {
    const d = new Date(r.at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const o = byDay.get(day) ?? {
      day,
      requests: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      hitRate: 0,
    };
    o.requests++;
    o.input += r.input;
    o.output += r.output;
    o.cacheRead += r.cacheRead;
    o.cost += r.cost;
    o.hitRate = o.cacheRead / (o.input + o.cacheRead);
    byDay.set(day, o);
  }
  const days = [...byDay.values()];
  const total = days.reduce(
    (a, d) => ({
      requests: a.requests + d.requests,
      input: a.input + d.input,
      output: a.output + d.output,
      cacheRead: a.cacheRead + d.cacheRead,
      cacheWrite: 0,
      cost: a.cost + d.cost,
      hitRate: 0,
    }),
    { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, hitRate: 0 },
  );
  total.hitRate = total.cacheRead / (total.input + total.cacheRead);
  const tokens = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    key: `sample-${choice}`,
    on: true,
    now: {
      tokens,
      window,
      foldAt: window * 0.9,
      choice,
      modelWindow,
      parts,
      items: [
        item("system", "系统提示词", 9_000, "你是 AgentHerd 的主管……"),
        item(
          "memory",
          "记忆",
          300,
          "[记忆 · 主人画像 — 用量 41/600 字]\n- 称呼：火哥\n- 作息：常写代码到半夜",
        ),
        item("tools", "session_start", 1_400, '{ "name": "session_start", … }'),
        item("tools", "web_search", 1_100, '{ "name": "web_search", … }'),
        item("tools", "memory", 980, '{ "name": "memory", … }'),
        item(
          "folds",
          "b4 · 11 月上半的事",
          3_100,
          "[Compressed conversation section] — 11 月上半的事……",
        ),
        item(
          "folds",
          "b3 · 调研 Agent 搜索方案",
          2_400,
          "[Compressed conversation section] — 搜索方案……",
        ),
        item(
          "owner",
          "今天腾讯和快手哪个跌得多？",
          60,
          "[Owner's message]\n今天腾讯和快手哪个跌得多？",
        ),
        item("herder", "调用 stock_quote", 120, 'stock_quote({"symbols":["00700","01024"]})'),
        item("results", "web_read", 9_800, "# Hermes web-search-plus\n……"),
      ],
    },
    facts: {
      messages: 300,
      tokens: 128_400,
      rounds: 60,
      activeFolds: 2,
      folds: 4,
      saved: 54_000 - 3_100 + 40 * 360 - 2_400,
      shown: 109,
      lastHitRate: 0.92,
    },
    segments: [
      {
        kind: "fold",
        blockId: "b4",
        startSeq: 0,
        endSeq: 150,
        messages: 151,
        tokensBefore: 54_000,
        tokensAfter: 3_100,
      },
      {
        kind: "fold",
        blockId: "b3",
        startSeq: 151,
        endSeq: 190,
        messages: 40,
        tokensBefore: 14_400,
        tokensAfter: 2_400,
      },
      { kind: "raw", startSeq: 191, endSeq: 299, messages: 109, tokens: 58_200 },
    ],
    folds,
    rounds,
    requests,
    days,
    total,
    events: [
      { at: atOf(240), kind: "start", data: { messages: 240, folds: 4, repaired: ["b3"] } },
      { at: atOf(240), kind: "fold.repaired", data: { blockId: "b3", startSeq: 151, endSeq: 190 } },
    ],
  };
}

/** Messages `from`–`to` of the sample conversation. */
export function sampleHerderMessages(from: number, to: number): HerderMessageView[] {
  const start = Date.now() - 6 * 24 * 3_600_000;
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => {
    const seq = from + i;
    const at = new Date(start + (seq / 300) * 6 * 24 * 3_600_000).toISOString();
    const n = seq % 5;
    if (n === 0)
      return {
        seq,
        at,
        role: "user",
        kind: "owner",
        round: seq,
        tokens: 60,
        text: "[Now: 2026-11-20 14:02, Friday]\n[Owner's message]\n看看今天腾讯和快手哪个跌得多",
        more: 0,
      };
    if (n === 1 || n === 3)
      return {
        seq,
        at,
        role: "assistant",
        kind: "call",
        tool: "stock_quote",
        round: seq - n,
        tokens: 80,
        text: 'stock_quote({"symbols":["00700","01024"]})',
        more: 0,
      };
    if (n === 2)
      return {
        seq,
        at,
        role: "toolResult",
        kind: "result",
        tool: "stock_quote",
        round: seq - n,
        tokens: 900,
        text: "00700 腾讯控股 -6.55%\n01024 快手 -4.16%",
        more: 0,
      };
    return {
      seq,
      at,
      role: "assistant",
      kind: "reply",
      round: seq - n,
      tokens: 120,
      text: "腾讯跌得多：腾讯 -6.55%，快手 -4.16%",
      more: 0,
    };
  });
}

/** What the 信箱 page shows in the browser preview (ADR 0099); `empty` has no sources yet. */
export function sampleMailbox(empty: boolean): MailboxView {
  const every = {
    github: { min: 5, default: 10 },
    work: { min: 5, default: 5 },
    mail: { min: 3, default: 5 },
    social: { min: 20, default: 20 },
    rss: { min: 15, default: 60 },
    hn: { min: 15, default: 60 },
    script: { min: 1, default: 30 },
    timer: { min: 0, default: 0 },
  };
  if (empty) return { on: true, sources: [], letters: [], every, digestHour: 9 };
  const sources: MailboxSourceView[] = [
    {
      id: "m-codex",
      kind: "github",
      name: "codex",
      note: "macOS 上崩溃、卡住的马上告诉我，新版本早上汇总",
      config: { repo: "openai/codex", what: ["issues", "releases"] },
      everyMinutes: 10,
      paused: false,
      by: "herder",
      createdAt: hoursFromNow(-50),
      started: true,
      lastRunAt: hoursFromNow(-0.1),
      lastOkAt: hoursFromNow(-0.1),
      fails: 0,
      letters: 4,
      act: "sort",
      trials: 0,
    },
    {
      id: "m-simon",
      kind: "rss",
      name: "simonwillison.net",
      note: "讲 agent 和记忆的文章留到汇总",
      config: { url: "https://simonwillison.net/atom/everything/" },
      everyMinutes: 60,
      paused: false,
      by: "owner",
      createdAt: hoursFromNow(-30),
      started: true,
      lastRunAt: hoursFromNow(-0.6),
      lastOkAt: hoursFromNow(-0.6),
      fails: 0,
      letters: 2,
      act: "sort",
      trials: 0,
    },
    {
      id: "m-hn",
      kind: "hn",
      name: "HN：agent memory",
      note: "100 分以上的告诉我",
      config: { words: "agent memory", points: 50 },
      everyMinutes: 60,
      paused: false,
      by: "owner",
      createdAt: hoursFromNow(-20),
      started: true,
      lastRunAt: hoursFromNow(-0.4),
      lastError: "hn.algolia.com answered 503",
      fails: 1,
      letters: 1,
      act: "sort",
      trials: 0,
    },
    {
      id: "m-prices",
      kind: "script",
      name: "机票价格",
      note: "上海到东京低于 2000 告诉我",
      config: { command: "python3 ~/bin/flights.py" },
      everyMinutes: 120,
      paused: true,
      by: "owner",
      createdAt: hoursFromNow(-80),
      started: true,
      lastRunAt: hoursFromNow(-26),
      fails: 0,
      letters: 0,
      act: "sort",
      trials: 0,
    },
    {
      id: "m-work",
      kind: "work",
      name: "派给我的活",
      note: "PI-Desktop 的 issue 问我要不要开任务",
      config: { what: ["assigned"], repo: "vastsa/PI-Desktop" },
      everyMinutes: 5,
      paused: false,
      by: "herder",
      createdAt: hoursFromNow(-40),
      started: true,
      lastRunAt: hoursFromNow(-0.05),
      lastOkAt: hoursFromNow(-0.05),
      fails: 0,
      letters: 1,
      act: "offer",
      trials: 0,
    },
    {
      id: "m-morning",
      kind: "timer",
      name: "早上看 PI-Desktop",
      note: "看看 PI-Desktop 有没有新 issue，有好上手的就告诉我，没有就不用说",
      config: { when: { kind: "daily", at: "09:00", days: [1, 2, 3, 4, 5] } },
      everyMinutes: 0,
      paused: false,
      by: "herder",
      createdAt: hoursFromNow(-100),
      started: true,
      lastRunAt: hoursFromNow(-6),
      fails: 0,
      letters: 3,
      act: "sort",
      trials: 0,
      nextAt: hoursFromNow(18),
    },
    {
      id: "m-xhs",
      kind: "social",
      name: "小红书的评论和@",
      note: "有人评论或 @ 我就告诉我",
      config: { platform: "xiaohongshu" },
      everyMinutes: 20,
      paused: false,
      by: "owner",
      createdAt: hoursFromNow(-60),
      started: true,
      lastRunAt: hoursFromNow(-0.2),
      lastOkAt: hoursFromNow(-0.2),
      fails: 0,
      letters: 0,
      act: "sort",
      trials: 0,
    },
  ];
  const letter = (
    id: number,
    source: MailboxSourceView,
    hours: number,
    title: string,
    rest: Partial<MailboxLetterView>,
  ): MailboxLetterView => ({
    id,
    sourceId: source.id,
    letterId: `${source.kind}:${id}`,
    source: source.name,
    kind: source.kind,
    at: hoursFromNow(-hours),
    title,
    body: "",
    sentAt: hoursFromNow(-hours),
    ...rest,
  });
  const [codex, simon, hn, , work, morning] = sources as MailboxSourceView[] & {
    0: MailboxSourceView;
    1: MailboxSourceView;
    2: MailboxSourceView;
    4: MailboxSourceView;
    5: MailboxSourceView;
  };
  const letters: MailboxLetterView[] = [
    letter(11, work, 0.05, "派给你的 issue vastsa/PI-Desktop #2214 文件树拖拽后顺序错乱", {
      link: "https://github.com/vastsa/PI-Desktop/issues/2214",
      fate: "now",
      why: "问你要不要开任务",
    }),
    letter(10, morning, 6, "早上看 PI-Desktop", {
      fate: "now",
      why: "到点了，交给主管去做",
    }),
    letter(9, codex, 0.1, "#7012 Crash on macOS 26 when resuming a session", {
      link: "https://github.com/openai/codex/issues/7012",
      sentAt: undefined,
    }),
    letter(8, hn, 1.2, "Show HN: A memory layer for coding agents", {
      link: "https://news.ycombinator.com/item?id=46000001",
      fate: "digest",
      why: "跟你在做的记忆有关，82 分还不到 100",
    }),
    letter(7, codex, 2, "#7008 codex exec hangs on macOS after sleep", {
      link: "https://github.com/openai/codex/issues/7008",
      fate: "now",
      why: "macOS 上卡住，你说过要马上知道",
    }),
    letter(6, codex, 5, "发布 rust-v0.72.0", {
      link: "https://github.com/openai/codex/releases/tag/rust-v0.72.0",
      fate: "digest",
      why: "新版本，按你说的早上汇总",
    }),
    letter(5, simon, 9, "Prompt injection in agent memory, again", {
      link: "https://simonwillison.net/2026/Nov/21/memory-injection/",
      fate: "digest",
      why: "讲 agent 记忆的安全问题",
      digestedAt: hoursFromNow(-3),
    }),
    letter(4, codex, 14, "#6990 Typo in docs/config.md", {
      link: "https://github.com/openai/codex/issues/6990",
      fate: "noted",
      why: "文档错字，跟你没关系",
    }),
    letter(3, simon, 26, "Weeknotes: a quiet week", {
      link: "https://simonwillison.net/2026/Nov/20/weeknotes/",
      fate: "noted",
      why: "周记，没有你关心的内容",
    }),
  ];
  return { on: true, sources, letters, every, digestHour: 9 };
}
