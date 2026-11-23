// E2E for the Herder's mailbox (ADR 0099): code looks at each source on its own clock; the first
// look only remembers what is there; only letters a source has not brought before go to the
// Herder, together; what the Herder files is kept; the ones it kept for the digest come back once
// a day; a source failing again and again is told to the owner once. Since ADR 0100 timers, GitHub
// work, mail and 小红书/知乎 notices are sources too: a timer hands its words to the Herder at its
// time; a source can offer each letter to the owner or start work itself.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AskView, TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import type { HerderHost } from "../../src/herder-port.ts";
import type { CheckResult, Letter, LetterDelivery, MailboxSource } from "../../src/mailbox.ts";
import type { Schedule } from "../../src/schedules.ts";
import { Store } from "../../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "agentherd-mailbox-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

/** A source that answers what the test put in it. */
class FakeSource {
  letters: Letter[] = [];
  fail: string | undefined;
  skip = false;
  looks: { source: MailboxSource; state: unknown }[] = [];

  check = async (source: MailboxSource, state: unknown): Promise<CheckResult> => {
    this.looks.push({ source, state });
    if (this.fail !== undefined) throw new Error(this.fail);
    if (this.skip) return { letters: [], skipped: true };
    return { letters: this.letters, state: { looks: this.looks.length } };
  };
}

/** A local time as a "once" timer writes it. */
function localStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

async function setup(opts: { herder?: boolean } = {}) {
  const channel = new FakeChannel("owner");
  const clock = new FakeClock("2026-11-04T00:00:00.000Z");
  const store = Store.open(":memory:");
  const source = new FakeSource();
  const deliveries: LetterDelivery[] = [];
  const scheduled: Schedule[] = [];
  const work: { text: string; auto: boolean; trial: boolean | undefined }[] = [];
  let host: HerderHost | undefined;
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles: [],
    store,
    clock,
    boardDebounceMs: 10,
    mailbox: { check: source.check, digestHour: 0 },
    ...(opts.herder === false
      ? {}
      : {
          herder: (h: HerderHost) => {
            host = h;
            return {
              ownerMessage() {},
              ownerAnswer() {},
              event() {},
              letters: (d: LetterDelivery) => deliveries.push(d),
              scheduled: (s: Schedule) => scheduled.push(s),
              intake: (text: string, auto: boolean, trial?: boolean) =>
                work.push({ text, auto, trial }),
              stop: async () => {},
            };
          },
        }),
  });
  herds.push(herd);
  await herd.start();
  return { herd, channel, clock, store, source, deliveries, scheduled, work, host: () => host };
}

const issue = (n: number, title: string): Letter => ({
  id: `issue:${n}`,
  title: `#${n} ${title}`,
  body: "someone wrote this",
  link: `https://github.com/openai/codex/issues/${n}`,
});

const titles = (d: LetterDelivery | undefined) =>
  d?.groups.flatMap((g) => g.letters.map((l) => l.title)) ?? [];

describe("E2E-MAILBOX (ADR 0099)", () => {
  it("remembers what is there on the first look and delivers only new letters, together", async () => {
    const { herd, clock, source, deliveries } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    source.letters = [issue(1, "old one"), issue(2, "old two")];
    const added = mailbox.add({
      kind: "github",
      name: "codex",
      note: "Tell me about crashes on macOS.",
      config: { repo: "openai/codex" },
    });
    expect(added.everyMinutes).toBe(10);
    await herd.checkMailbox();
    expect(source.looks).toHaveLength(1);
    expect(deliveries).toEqual([]);
    expect(mailbox.list()[0]?.started).toBe(true);

    // Not due yet: no look.
    source.letters = [issue(3, "crash on start"), ...source.letters];
    await clock.advance(5 * 60_000);
    await herd.checkMailbox();
    expect(source.looks).toHaveLength(1);

    await clock.advance(5 * 60_000);
    await herd.checkMailbox();
    expect(source.looks).toHaveLength(2);
    expect(source.looks[1]?.state).toEqual({ looks: 1 });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.kind).toBe("new");
    expect(deliveries[0]?.groups[0]).toMatchObject({
      name: "codex",
      kind: "github",
      note: "Tell me about crashes on macOS.",
    });
    expect(titles(deliveries[0])).toEqual(["#3 crash on start"]);

    // The same letters again: nothing new.
    await clock.advance(10 * 60_000);
    await herd.checkMailbox();
    expect(deliveries).toHaveLength(1);
    expect(mailbox.letters()).toHaveLength(1);
  });

  it("keeps what the Herder made of each letter and brings the digest ones back once a day", async () => {
    const { herd, clock, source, deliveries, host } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    mailbox.add({ kind: "rss", name: "blog", config: { url: "https://example.com/feed" } });
    await herd.checkMailbox();
    source.letters = [issue(7, "a post"), issue(8, "another")];
    await clock.advance(60 * 60_000);
    await herd.checkMailbox();
    const [a, b] = deliveries[0]?.groups[0]?.letters ?? [];
    if (a === undefined || b === undefined) throw new Error("no letters");
    expect(
      host()?.fileLetters?.([
        { id: a.id, fate: "digest", why: "worth a look in the morning" },
        { id: b.id, fate: "noted", why: "nothing new" },
        { id: 999, fate: "now", why: "?" },
      ]),
    ).toEqual([999]);
    expect(() => host()?.fileLetters?.([{ id: a.id, fate: "later" as never, why: "" }])).toThrow(
      /fate must be one of/,
    );
    expect(mailbox.letters().map((l) => [l.title, l.fate, l.why])).toEqual([
      ["#8 another", "noted", "nothing new"],
      ["#7 a post", "digest", "worth a look in the morning"],
    ]);

    // The digest went out (empty) on the first tick today; tomorrow the kept one comes back.
    await clock.advance(24 * 60 * 60_000);
    await herd.checkMailbox();
    const digest = deliveries.find((d) => d.kind === "digest");
    expect(titles(digest)).toEqual(["#7 a post"]);
    await clock.advance(60 * 60_000);
    await herd.checkMailbox();
    expect(deliveries.filter((d) => d.kind === "digest")).toHaveLength(1);
  });

  it("tells the owner once when a source keeps failing, and a paused one is not looked at", async () => {
    const { herd, channel, clock, source } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    const s = mailbox.add({ kind: "hn", name: "agents on HN", config: { words: "agent" } });
    source.fail = "Hacker News did not answer";
    await herd.checkMailbox();
    for (let i = 0; i < 4; i++) {
      await clock.advance(60 * 60_000);
      await herd.checkMailbox();
    }
    const said = channel.messages
      .filter((m) => m.view.kind === "text")
      .map((m) => (m.view as TextView).text)
      .filter((t) => t.includes("agents on HN"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("failed 3 looks in a row: Hacker News did not answer");
    expect(mailbox.list()[0]).toMatchObject({ fails: 5, lastError: "Hacker News did not answer" });

    mailbox.set(s.id, { paused: true });
    const looks = source.looks.length;
    await clock.advance(2 * 60 * 60_000);
    await herd.checkMailbox();
    expect(source.looks).toHaveLength(looks);
  });

  it("a try keeps nothing; changing the source starts it over; limits hold", async () => {
    const { herd, source, deliveries } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    source.letters = [issue(1, "one"), { id: "", title: "no id" } as Letter];
    const tried = await mailbox.tryOut({ kind: "script", name: "mine", config: { command: "x" } });
    expect(tried.map((l) => l.title)).toEqual(["#1 one"]);
    expect(mailbox.letters()).toHaveLength(0);

    const gh = mailbox.add({ kind: "github", name: "repo", config: { repo: "a/b" } });
    await herd.checkMailbox();
    expect(mailbox.list().find((s) => s.id === gh.id)?.started).toBe(true);
    mailbox.set(gh.id, { config: { repo: "a/c" } });
    await herd.checkMailbox();
    // A new first look: what a/c has now is only remembered.
    expect(deliveries).toHaveLength(0);
    expect(() => mailbox.add({ kind: "github", name: "x", everyMinutes: 1 })).toThrow(
      /every 5 minutes at most/,
    );
    expect(() => mailbox.add({ kind: "fax" as never, name: "x" })).toThrow(/kind must be/);
    expect(() => mailbox.add({ kind: "github", name: "x", act: "maybe" as never })).toThrow(
      /act must be one of sort, offer, trial, auto/,
    );
  });

  it("letters wait while there is no Herder", async () => {
    const { herd, clock, source, store } = await setup({ herder: false });
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    mailbox.add({ kind: "github", name: "codex", config: { repo: "openai/codex" } });
    await herd.checkMailbox();
    source.letters = [issue(5, "new")];
    await clock.advance(10 * 60_000);
    await herd.checkMailbox();
    expect(store.mailbox.unsent(10).map((l) => l.title)).toEqual(["#5 new"]);
  });
});

describe("E2E-MAILBOX-ALL (ADR 0100)", () => {
  it("a timer hands its words to the Herder at its time; a one-time timer goes away after it ran", async () => {
    const { herd, clock, source, scheduled, store } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    const every = mailbox.add({
      kind: "timer",
      name: "看看 issue",
      note: "看看 PI-Desktop 有没有新 issue，有就告诉我",
      config: { when: { kind: "every", hours: 2 } },
    });
    expect(every.started).toBe(true);
    expect(mailbox.nextAt(every)).toBe("2026-11-04T02:00:00.000Z");
    await herd.checkMailbox();
    expect(scheduled).toEqual([]);
    await clock.advance(2 * 60 * 60_000);
    await herd.checkMailbox();
    expect(scheduled.map((s) => [s.id, s.about, s.prompt])).toEqual([
      [every.id, "看看 issue", "看看 PI-Desktop 有没有新 issue，有就告诉我"],
    ]);
    expect(mailbox.nextAt(mailbox.list()[0] as MailboxSource)).toBe("2026-11-04T04:00:00.000Z");
    // Each run is a letter filed "now", so the page shows when the timer ran.
    expect(mailbox.letters().map((l) => [l.title, l.fate])).toEqual([["看看 issue", "now"]]);
    expect(source.looks).toHaveLength(0);

    // Missed runs while AgentHerd was off run once.
    mailbox.stop();
    await clock.advance(7 * 60 * 60_000);
    mailbox.start();
    await herd.checkMailbox();
    expect(scheduled).toHaveLength(2);

    // Run now keeps the next time.
    const next = mailbox.nextAt(mailbox.list()[0] as MailboxSource);
    await mailbox.runNow(every.id);
    expect(scheduled).toHaveLength(3);
    expect(mailbox.nextAt(mailbox.list()[0] as MailboxSource)).toBe(next);

    const at = new Date(clock.now().getTime() + 30 * 60_000);
    const once = mailbox.add({
      kind: "timer",
      name: "提醒开会",
      note: "提醒我三点开会",
      config: { when: { kind: "once", at: localStamp(at) } },
    });
    await clock.advance(31 * 60_000);
    await herd.checkMailbox();
    expect(scheduled.at(-1)?.prompt).toBe("提醒我三点开会");
    expect(mailbox.list().some((s) => s.id === once.id)).toBe(false);
    expect(store.auditRows("mailbox.done")).toHaveLength(1);

    expect(() => mailbox.add({ kind: "timer", name: "x", note: "y" })).toThrow(
      /a timer needs when/,
    );
    expect(() =>
      mailbox.add({ kind: "timer", name: "x", config: { when: { kind: "every", hours: 3 } } }),
    ).toThrow(/a timer needs words for the Herder/);
    expect(() =>
      mailbox.add({
        kind: "timer",
        name: "x",
        note: "y",
        config: { when: { kind: "once", at: "2020-01-01 09:00" } },
      }),
    ).toThrow(/already past/);
    const paused = mailbox.set(every.id, { paused: true });
    expect(mailbox.nextAt(paused)).toBeUndefined();
  });

  it("offers each new letter to the owner; 开任务 hands it to the Herder, 忽略 closes it", async () => {
    const { herd, channel, clock, source, work, deliveries } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    mailbox.add({
      kind: "work",
      name: "派给我的 issue",
      config: { what: ["assigned"] },
      act: "offer",
    });
    await herd.checkMailbox();
    source.letters = [issue(11, "fix login"), issue(12, "fix logout")];
    await clock.advance(5 * 60_000);
    await herd.checkMailbox();
    // Offered letters do not go to the Herder for sorting.
    expect(deliveries).toEqual([]);
    const asks = channel.messages.filter((m) => m.view.kind === "ask");
    expect(asks).toHaveLength(2);
    const [first, second] = asks.map((m) => m.view as AskView);
    if (first === undefined || second === undefined) throw new Error("two offers expected");
    const ask = first;
    expect(ask.text).toContain("#11 fix login");
    expect(ask.askId.startsWith("mailbox:")).toBe(true);
    expect(mailbox.letters().map((l) => l.fate)).toEqual(["now", "now"]);

    await channel.tap(ask.askId, "start", "owner");
    await channel.tap(second.askId, "ignore", "owner");
    expect(work).toEqual([
      {
        text: expect.stringContaining(
          "派给我的 issue: #11 fix login https://github.com/openai/codex/issues/11",
        ),
        auto: false,
        trial: undefined,
      },
    ]);
    expect(mailbox.letters().map((l) => l.answer)).toEqual(["ignore", "start"]);
    // A second tap does nothing.
    await channel.tap(ask.askId, "start", "owner");
    expect(work).toHaveLength(1);
  });

  it("on a trial run the Herder only says what it would start; after it, work starts by itself", async () => {
    const { herd, channel, clock, source, work } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    const s = mailbox.add({
      kind: "work",
      name: "要我审的 PR",
      config: { what: ["reviews"] },
      act: "trial",
    });
    await herd.checkMailbox();
    source.letters = [issue(21, "review me")];
    await clock.advance(5 * 60_000);
    await herd.checkMailbox();
    expect(work).toEqual([
      { text: expect.stringContaining("#21 review me"), auto: true, trial: true },
    ]);
    expect(channel.messages.filter((m) => m.view.kind === "ask")).toHaveLength(1);
    expect(mailbox.list()[0]?.trials).toBe(1);

    mailbox.set(s.id, { act: "auto" });
    source.letters = [issue(22, "review me too"), ...source.letters];
    await clock.advance(5 * 60_000);
    await herd.checkMailbox();
    expect(work.at(-1)).toEqual({
      text: expect.stringContaining("#22"),
      auto: true,
      trial: undefined,
    });
    const said = channel.messages
      .filter((m) => m.view.kind === "text")
      .map((m) => (m.view as TextView).text);
    expect(said.some((t) => t.includes("要我审的 PR") && t.includes("#22 review me too"))).toBe(
      true,
    );
  });

  it("an account that is not signed in is not a look; 小红书 looks move a few minutes either way", async () => {
    const { herd, clock, source } = await setup();
    const mailbox = herd.mailbox;
    if (mailbox === undefined) throw new Error("no mailbox");
    source.skip = true;
    const s = mailbox.add({ kind: "social", name: "小红书", config: { platform: "xiaohongshu" } });
    expect(s.everyMinutes).toBe(20);
    await herd.checkMailbox();
    expect(mailbox.list()[0]?.started).toBe(false);
    expect(mailbox.list()[0]?.fails).toBe(0);

    source.skip = false;
    const gaps: number[] = [];
    let last = clock.now().getTime();
    for (let i = 0; i < 6; i++) {
      const looks = source.looks.length;
      while (source.looks.length === looks) {
        await clock.advance(60_000);
        await herd.checkMailbox();
      }
      gaps.push((clock.now().getTime() - last) / 60_000);
      last = clock.now().getTime();
    }
    expect(gaps.slice(1).every((g) => g >= 15 && g <= 26)).toBe(true);
    expect(mailbox.list()[0]?.started).toBe(true);
  });
});
