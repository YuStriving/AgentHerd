import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { expect, it } from "vitest";
import { runSearchFixture, SearchFixtureStillRunning } from "./search-fixture.js";

it("opens Tasks and Cards from the visible controls on either dock edge, for every grip art", async () => {
  const fixture = join(import.meta.dirname, "fixtures/pet-dock");
  const out = mkdtempSync(join(tmpdir(), "herd-pet-controls-"));
  let safeToRemove = true;
  try {
    await build({
      configFile: false,
      root: fixture,
      plugins: [react()],
      logLevel: "silent",
      build: { outDir: out, emptyOutDir: true },
      base: "./",
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const electron: string =
      process.env.AGENTHERD_TEST_ELECTRON ?? createRequire(import.meta.url)("electron");
    // The fixture stops on a deadline and reports why, so a stuck Electron shows its stderr.
    const result = await runSearchFixture(
      electron,
      [join(fixture, "run.cjs"), join(out, "index.html")],
      env,
      40_000,
    );
    expect(result).toHaveLength(8);
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
