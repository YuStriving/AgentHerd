import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PetWindow } from "../src/main/pet-window";

const ipc = new EventEmitter();
const cursor = { x: 500, y: 500 };
const display = { workArea: { x: 0, y: 0, width: 1000, height: 800 } };
let directory: string;
let window: FakeWindow;
class FakeWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn() });
  constructor(public bounds: { x: number; y: number; width: number; height: number }) {
    super();
    window = this;
  }
  setBounds(bounds: typeof this.bounds) {
    this.bounds = bounds;
  }
  getBounds() {
    return this.bounds;
  }
  isDestroyed() {
    return false;
  }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  setIgnoreMouseEvents() {}
  loadFile() {}
  close() {
    this.emit("closed");
  }
}
vi.mock("electron", () => ({
  get BrowserWindow() {
    return FakeWindow;
  },
  ipcMain: {
    on: (...args: Parameters<typeof ipc.on>) => ipc.on(...args),
    handle: (...args: Parameters<typeof ipc.on>) => ipc.on(...args),
  },
  screen: {
    getCursorScreenPoint: () => ({ ...cursor }),
    getDisplayNearestPoint: () => display,
    getPrimaryDisplay: () => display,
  },
  app: { getPath: () => directory },
}));
afterEach(() => {
  ipc.removeAllListeners();
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});
it.each(["right", "left"] as const)(
  "Claude grips the %s edge on release and restores it after restart",
  (side) => {
    vi.useFakeTimers();
    directory = mkdtempSync(join(tmpdir(), "herd-pet-"));
    const pet = new PetWindow({ preload: "", rendererDir: "", openApp: () => {} });
    const send = (event: string, ...args: unknown[]) =>
      ipc.emit(`pet:${event}`, { sender: window.webContents }, ...args);
    pet.set(true);
    send("resize", 150, 150, [{ x: 8, y: 8, width: 130, height: 130 }]);
    send("peek", true, false, true);
    cursor.x = side === "right" ? 870 : 955;
    send("drag-start");
    cursor.x = side === "right" ? 999 : 0;
    send("drag-move");
    send("drag-end");
    const pose = (value: string, animate = false) =>
      expect(window.webContents.send).toHaveBeenLastCalledWith("pet:pose", {
        side,
        pose: value,
        animate,
      });
    pose("grip", true);
    const anchor = window.bounds.x;
    send("peek", false, false, true);
    send("peek", true, false, true);
    pose("grip", true);
    cursor.y += 10;
    send("peek", false, false, true);
    send("peek", true, false, true);
    pose("full");
    send("peek", false, false, true);
    vi.advanceTimersByTime(599);
    send("peek", true, false, true);
    vi.advanceTimersByTime(601);
    pose("full");
    send("peek", false, false, true);
    vi.advanceTimersByTime(600);
    pose("grip", true);
    expect(window.bounds.x).toBe(anchor);
    send("peek", false, true, true);
    pose("full");
    pet.set(false);
    pet.set(true);
    send("peek", false, false, true);
    pose("grip");
    pet.set(false);
  },
);
