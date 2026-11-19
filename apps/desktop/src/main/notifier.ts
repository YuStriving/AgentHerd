// System notifications for the pet (ADR 0079): what waits for the owner and what tasks finished,
// told once, merged when several come together, quiet in quiet hours or while snoozed, and never
// while the owner is looking at AgentHerd. The decisions are in ../shared/pet-notify.ts.

import type { PetSettings, PetView } from "@agentherd/host/api";
import { Notification, type NotificationAction } from "electron";
import { isQuiet, mergeNotices, type Notice, NoticeWatch } from "../shared/pet-notify.ts";

/** Notifications kept alive so their click and button events still arrive. */
const LIVE_MAX = 20;

export interface NotifierOptions {
  /** The owner pressed a button on a notification: the card's answer, as in the pet. */
  press(target: string, action: string): void;
  /** The owner clicked the notification: show what it is about. */
  open(notice: Notice): void;
  /** An AgentHerd window has the keyboard: the owner already sees it. */
  looking(): boolean;
  log(message: string): void;
  icon?: string;
}

export class Notifier {
  private readonly watch = new NoticeWatch();
  private readonly live: Notification[] = [];
  private settings: PetSettings | undefined;
  private readonly opts: NotifierOptions;

  constructor(opts: NotifierOptions) {
    this.opts = opts;
  }

  setSettings(settings: PetSettings | undefined): void {
    this.settings = settings;
  }

  /** A new pet view from the host: tells what is new in it. */
  view(view: PetView): void {
    const notices = this.watch.next(view);
    const s = this.settings;
    // An older host has no notification settings: no notifications.
    if (notices.length === 0 || s?.notify !== true) return;
    if (isQuiet(s, new Date()) || this.opts.looking()) return;
    const notice = mergeNotices(notices);
    if (notice === undefined || !Notification.isSupported()) return;
    this.show(notice, s.sound && notice.ring);
  }

  private show(notice: Notice, ring: boolean): void {
    // Two buttons at most (同意 / 拒绝); macOS shows them only for a signed app.
    const options = (notice.options ?? []).slice(0, 2);
    const actions: NotificationAction[] = options.map((o) => ({ type: "button", text: o.label }));
    const note = new Notification({
      title: notice.title,
      body: notice.body,
      silent: !ring,
      ...(actions.length > 0 ? { actions } : {}),
      ...(this.opts.icon === undefined ? {} : { icon: this.opts.icon }),
    });
    note.on("click", () => this.opts.open(notice));
    note.on("action", (details, index) => {
      const at = typeof details?.actionIndex === "number" ? details.actionIndex : index;
      const option = options[at];
      if (option !== undefined && notice.target !== undefined) {
        this.opts.press(notice.target, option.action);
      }
    });
    note.on("close", () => this.forget(note));
    note.on("failed", (_e, error) => this.opts.log(`notification failed: ${error}`));
    this.live.push(note);
    if (this.live.length > LIVE_MAX) this.live.shift();
    note.show();
    this.opts.log(`notified: ${notice.title}${ring ? " (sound)" : ""}`);
  }

  private forget(note: Notification): void {
    const i = this.live.indexOf(note);
    if (i >= 0) this.live.splice(i, 1);
  }
}
