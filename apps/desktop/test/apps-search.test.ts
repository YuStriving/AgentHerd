import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { expect, it } from "vitest";
import { runSearchFixture, SearchFixtureStillRunning } from "./search-fixture.js";

it("keeps only matching apps while typing, after a late reply, and after an app event", async () => {
  const out = mkdtempSync(join(tmpdir(), "agentherd-search-"));
  let safeToRemove = true;
  try {
    await build({
      configFile: false,
      root: join(import.meta.dirname, "fixtures"),
      plugins: [react()],
      logLevel: "silent",
      build: { outDir: out, emptyOutDir: true },
      base: "./",
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const electron: string =
      process.env.AGENTHERD_TEST_ELECTRON ?? createRequire(import.meta.url)("electron");
    const result = await runSearchFixture(
      electron,
      [join(import.meta.dirname, "fixtures/apps-search.cjs"), join(out, "index.html")],
      env,
      60_000,
    );
    expect(result).toEqual({
      firstBatch: ["App 10", "App 11", "App 0", "App 1", "App 2"],
      secondBatch: [
        "App 10",
        "App 11",
        "App 0",
        "App 1",
        "App 2",
        "App 3",
        "App 4",
        "App 5",
        "App 6",
        "App 7",
      ],
      lastBatch: [
        "App 10",
        "App 11",
        "App 0",
        "App 1",
        "App 2",
        "App 3",
        "App 4",
        "App 5",
        "App 6",
        "App 7",
        "App 8",
        "App 9",
      ],
      moreAtEnd: false,
      extraCalls: 0,
      searchBatch: ["App 10", "App 11", "App 0", "App 1", "App 2"],
      searchExpanded: 10,
      resetBatch: 5,
      immediate: ["GitHub"],
      newer: ["GitHub"],
      late: ["GitHub"],
      storedAfterLate: ["gmail", "CODE_HOST"],
      clearedPending: ["Gmail", "GitHub"],
      slugOnly: ["GitHub"],
      event: ["GitHub"],
      cleared: ["Gmail", "GitHub"],
      noMatch: [],
    });
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
