// The menu bar icon on macOS and the tray icon on Windows (ADR 0079): how AgentHerd is doing at a
// glance, the way to the pet and the app, quiet for a while, and quit, also when the pet is
// folded or off.

import type { HostStatus, PetSettings, PetView, TasksView } from "@agentherd/host/api";
import { Menu, type MenuItemConstructorOptions, nativeImage, Tray } from "electron";
import { menuBarModel, type NoticeTab, snoozeUntil } from "../shared/pet-notify.ts";

export interface MenuBarState {
  connected: boolean;
  status?: HostStatus;
  tasks: TasksView["tasks"];
  view?: PetView;
}

export interface MenuBarActions {
  openApp(): void;
  /** Shows the pet's panel on a page; false when the pet is off. */
  showPet(tab: NoticeTab): boolean;
  setPet(patch: Partial<PetSettings>): void;
  quit(): void;
}

export interface MenuBarOptions extends MenuBarActions {
  /** A template image on macOS (black on clear, `…Template.png`), the app icon elsewhere. */
  icon: string;
  template: boolean;
}

/** How long the menu waits for more changes before it is rebuilt. */
const REBUILD_MS = 300;

export class MenuBar {
  private readonly tray: Tray;
  private state: MenuBarState = { connected: false, tasks: [] };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly minute: ReturnType<typeof setInterval>;
  private readonly opts: MenuBarOptions;

  constructor(opts: MenuBarOptions) {
    this.opts = opts;
    const image = nativeImage.createFromPath(opts.icon);
    const icon = opts.template ? image : image.resize({ width: 16, height: 16 });
    if (opts.template) icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    // Windows: a click opens the app, as before; macOS opens the menu.
    if (process.platform === "win32") this.tray.on("click", () => opts.openApp());
    this.build();
    // Quiet hours start and end, and snoozes run out, without any event.
    this.minute = setInterval(() => this.build(), 60_000);
  }

  update(patch: Partial<MenuBarState>): void {
    this.state = { ...this.state, ...patch };
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.build();
    }, REBUILD_MS);
  }

  destroy(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    clearInterval(this.minute);
    this.tray.destroy();
  }

  private build(): void {
    const now = new Date();
    const s = this.state;
    const m = menuBarModel({
      connected: s.connected,
      ...(s.status === undefined ? {} : { status: s.status }),
      tasks: s.tasks,
      ...(s.view === undefined ? {} : { view: s.view }),
      now,
    });
    const pet = s.status?.pet;
    if (process.platform === "darwin") this.tray.setTitle(m.title);
    this.tray.setToolTip(m.tooltip);
    const show = (tab: NoticeTab) => () => {
      if (!this.opts.showPet(tab)) this.opts.openApp();
    };
    const items: MenuItemConstructorOptions[] = [
      { label: m.status, enabled: false },
      ...(m.quiet === undefined ? [] : [{ label: m.quiet, enabled: false }]),
      ...(m.waiting > 0
        ? [{ label: `${m.waiting} 件等你处理…`, click: show("cards"), ...keyOf(pet?.approveKey) }]
        : []),
      ...(m.running > 0 ? [{ label: "看在跑的任务…", click: show("tasks") }] : []),
      { type: "separator" },
      {
        label: "和主管说话…",
        enabled: pet?.on === true,
        click: show("chat"),
        ...keyOf(pet?.talkKey),
      },
      {
        label: "显示桌宠",
        type: "checkbox",
        checked: pet?.on === true,
        enabled: pet !== undefined,
        click: () => this.opts.setPet({ on: pet?.on !== true }),
      },
      { label: "打开 AgentHerd", click: () => this.opts.openApp() },
      { type: "separator" },
      {
        label: "免打扰",
        enabled: pet?.quietUntil !== undefined,
        submenu: [
          {
            label: "暂停 1 小时",
            click: () => this.opts.setPet({ quietUntil: snoozeUntil("hour", new Date()) }),
          },
          {
            label: "到明早 8 点",
            click: () => this.opts.setPet({ quietUntil: snoozeUntil("morning", new Date()) }),
          },
          {
            label: "恢复提醒",
            enabled: pet?.quietUntil !== undefined && pet.quietUntil !== "",
            click: () => this.opts.setPet({ quietUntil: "" }),
          },
          { type: "separator" },
          {
            label: "系统通知",
            type: "checkbox",
            checked: pet?.notify === true,
            click: () => this.opts.setPet({ notify: pet?.notify !== true }),
          },
          {
            label: "提示音",
            type: "checkbox",
            checked: pet?.sound === true,
            enabled: pet?.notify === true,
            click: () => this.opts.setPet({ sound: pet?.sound !== true }),
          },
        ],
      },
      { type: "separator" },
      { label: "退出 AgentHerd", click: () => this.opts.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }
}

/** Shows a global shortcut next to its menu item; the item does not take the key (ADR 0080). */
function keyOf(accel: string | undefined): { accelerator?: string; registerAccelerator?: boolean } {
  if (accel === undefined || accel === "") return {};
  return { accelerator: accel, registerAccelerator: false };
}
