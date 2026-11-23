import { createRoot } from "react-dom/client";
import { Pet } from "../../../src/renderer/src/pet/Pet";
import { hitPetRegion, type PetBridge, type PetPose } from "../../../src/shared/bridge";
import "../../../src/renderer/src/pet/pet.css";

let rendererError: string | undefined;
window.addEventListener("error", (event) => {
  rendererError = event.message;
});

const noop = () => {};
/** Claude has its own grip picture; Miku stands for the figures that lean their resting frame. */
let figure = "claude";
let report: Parameters<PetBridge["resize"]> | undefined;
let pose: (value: PetPose) => void = noop;
Object.assign(window, {
  agentherd: {
    host: {
      pet: async () => ({
        connected: true,
        history: [],
        pending: [{ target: "open", title: "Review request", body: "Check it", options: [] }],
      }),
      tasks: async () => ({
        tasks: [
          {
            id: "work",
            title: "Working task",
            stage: "working",
            lastReport: "",
            startedAt: new Date().toISOString(),
          },
        ],
      }),
      status: async () => ({ pet: { figure } }),
    },
    pet: {
      onMouseLeave: () => noop,
      resize: (...args: Parameters<PetBridge["resize"]>) => {
        report = args;
      },
      interacting: noop,
      onPose: (listener: typeof pose) => {
        pose = listener;
        return noop;
      },
    },
    onEvent: () => noop,
    onConnection: () => noop,
  },
});

const until = async (check: () => unknown, step: string) => {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (rendererError) throw new Error(rendererError);
    if (Date.now() > deadline) throw new Error(`Docked pet scenario timed out: ${step}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const CONTROLS = ".pet-dot-task, .pet-badge";

/**
 * Once the grip picture has loaded, the reported regions must follow its pixels: some points of
 * the figure's box inside the window take the mouse and the clear ones let it through.
 */
async function checkPassThrough(side: "left" | "right") {
  const root = document.querySelector<HTMLElement>(".pet-root");
  const box = root?.querySelector<HTMLElement>(`[data-grip="${side}"] .pet-figure`);
  const img = box?.querySelector("img");
  if (!root || !box || !img) throw new Error(`${figure} ${side}: no grip picture`);
  const controls = root.querySelectorAll(CONTROLS).length;
  await until(
    () => img.complete && img.naturalWidth > 0 && (report?.[3]?.length ?? 0) > controls,
    `${figure} ${side} picture mask`,
  );
  if (!report) throw new Error("No size report");
  const [width, height, , regions] = report;
  const base = root.getBoundingClientRect();
  const r = box.getBoundingClientRect();
  const blocked = Array.from(root.querySelectorAll(CONTROLS), (c) => c.getBoundingClientRect());
  let inside = 0;
  let hit = 0;
  for (let y = Math.max(r.top, base.top) + 1; y < Math.min(r.bottom, base.bottom); y += 3) {
    for (let x = Math.max(r.left, base.left) + 1; x < Math.min(r.right, base.right); x += 3) {
      if (blocked.some((c) => x >= c.left && x < c.right && y >= c.top && y < c.bottom)) continue;
      inside += 1;
      if (hitPetRegion(x - base.left, y - base.top, { width, height }, regions ?? [])) hit += 1;
    }
  }
  if (hit === 0 || hit === inside) {
    throw new Error(`${figure} ${side}: ${hit} of ${inside} points take the mouse`);
  }
  return { side, hit, inside };
}

async function clickDocked(side: "left" | "right", selector: string, tab: string) {
  pose({ side, pose: "grip", animate: false });
  const art = figure === "claude" ? "pose" : "frame";
  await until(
    () =>
      document.querySelector(`[data-grip="${side}"] ${selector}`) &&
      document.querySelector(`[data-grip="${side}"] .pet-figure[data-art="${art}"]`) &&
      report?.[3],
    `show ${figure} ${side} ${selector}`,
  );
  const passThrough = await checkPassThrough(side);
  const stage = document.querySelector<HTMLElement>(".pet-root");
  const control = stage?.querySelector<HTMLButtonElement>(selector);
  if (!stage || !control || !report) throw new Error(`Missing ${selector}`);
  const rect = control.getBoundingClientRect();
  const bounds = stage.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const [width, height, , regions] = report;
  if (
    document.elementFromPoint(x, y) !== control ||
    !hitPetRegion(x - bounds.left, y - bounds.top, { width, height }, regions ?? [])
  ) {
    throw new Error(`${figure} ${side} ${selector} does not receive clicks in the grip pose`);
  }
  control.click();
  await until(() => document.querySelector(".pet-bubble"), `open ${tab}`);
  if (localStorage.getItem("agentherd.pet.tab") !== tab) throw new Error(`Expected ${tab} to open`);
  return passThrough;
}

Object.assign(window, {
  runDockScenario: async () => {
    const checked = [];
    for (const name of ["claude", "miku"]) {
      figure = name;
      for (const side of ["left", "right"] as const) {
        for (const [selector, tab] of [
          [".pet-dot-task", "tasks"],
          [".pet-badge", "cards"],
        ] as const) {
          localStorage.clear();
          report = undefined;
          const container = document.getElementById("root");
          if (!container) throw new Error("Missing pet root");
          const root = createRoot(container);
          root.render(<Pet />);
          await until(() => document.querySelector(selector), `render ${selector}`);
          checked.push({ figure, ...(await clickDocked(side, selector, tab)) });
          root.unmount();
        }
      }
    }
    return checked;
  },
});
