// The pet's global shortcuts in main (ADR 0080): registered with the system while AgentHerd runs,
// changed when the settings change, paused while the settings page records a new one.

import { globalShortcut } from "electron";
import type { ShortcutState } from "../shared/pet-shortcuts.ts";

export interface ShortcutOptions {
  talk: () => void;
  approve: () => void;
  /** The state changed: which shortcuts work and which another app holds. */
  changed: (state: ShortcutState) => void;
  log: (line: string) => void;
}

type Name = keyof ShortcutState;

export class Shortcuts {
  private keys: Record<Name, string> = { talk: "", approve: "" };
  private held: Record<Name, string> = { talk: "", approve: "" };
  private paused = false;
  private current: ShortcutState = { talk: "off", approve: "off" };
  private readonly opts: ShortcutOptions;

  constructor(opts: ShortcutOptions) {
    this.opts = opts;
  }

  state(): ShortcutState {
    return { ...this.current };
  }

  /** The keys from the settings; "" turns one off. */
  set(keys: Record<Name, string>): void {
    if (keys.talk === this.keys.talk && keys.approve === this.keys.approve) return;
    this.keys = { ...keys };
    this.apply();
  }

  /** Lets go of the keys while the settings page records a new one, so it sees the press. */
  pause(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.apply();
  }

  dispose(): void {
    this.release("talk");
    this.release("approve");
  }

  private apply(): void {
    const next: ShortcutState = { talk: "off", approve: "off" };
    for (const name of ["talk", "approve"] as const) {
      const want = this.paused ? "" : this.keys[name];
      if (this.held[name] !== want) {
        this.release(name);
        if (want !== "") this.hold(name, want);
      }
      if (this.keys[name] === "") next[name] = "off";
      else if (this.paused) next[name] = this.current[name] === "taken" ? "taken" : "ok";
      else next[name] = this.held[name] === this.keys[name] ? "ok" : "taken";
    }
    const changed = next.talk !== this.current.talk || next.approve !== this.current.approve;
    this.current = next;
    if (changed) this.opts.changed(this.state());
  }

  private hold(name: Name, accel: string): void {
    let ok = false;
    try {
      ok = globalShortcut.register(accel, () =>
        name === "talk" ? this.opts.talk() : this.opts.approve(),
      );
    } catch (error) {
      this.opts.log(`shortcut ${accel}: ${(error as Error).message}`);
    }
    if (ok) this.held[name] = accel;
    else this.opts.log(`shortcut ${accel} is taken by another app`);
  }

  private release(name: Name): void {
    const accel = this.held[name];
    if (accel === "") return;
    try {
      globalShortcut.unregister(accel);
    } catch {
      // already gone
    }
    this.held[name] = "";
  }
}
