import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { expect, it } from "vitest";
import { runSearchFixture, SearchFixtureStillRunning } from "./search-fixture.js";

it("toggles the conversation without losing its draft or closing the pet", async () => {
  const out = mkdtempSync(join(tmpdir(), "agentherd-pet-talk-"));
  const src = join(import.meta.dirname, "../src");
  const renderer = join(src, "renderer");
  let safeToRemove = true;
  try {
    await build({
      configFile: false,
      root: renderer,
      plugins: [react()],
      logLevel: "silent",
      base: "./",
      build: {
        outDir: out,
        emptyOutDir: true,
        rollupOptions: { input: join(renderer, "pet.html") },
      },
    });
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        outDir: out,
        emptyOutDir: false,
        lib: {
          entry: {
            preload: join(src, "preload/index.ts"),
            "pet-window": join(src, "main/pet-window.ts"),
          },
          formats: ["cjs"],
          fileName: (_format, name) => `${name}.cjs`,
        },
        rollupOptions: { external: (id) => id === "electron" || id.startsWith("node:") },
      },
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const electron: string =
      process.env.AGENTHERD_TEST_ELECTRON ?? createRequire(import.meta.url)("electron");
    const result = await runSearchFixture(
      electron,
      [join(import.meta.dirname, "fixtures/pet-talk.cjs"), out],
      env,
      60_000,
    );
    expect(result).toEqual({ figureVisible: true, draft: "unfinished message" });
  } catch (error) {
    if (error instanceof SearchFixtureStillRunning) {
      safeToRemove = false;
      throw new Error(`${error.message}; retained fixture files at ${out}`, { cause: error });
    }
    throw error;
  } finally {
    if (safeToRemove) rmSync(out, { recursive: true, force: true });
  }
}, 90_000);
