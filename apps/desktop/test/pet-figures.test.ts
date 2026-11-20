import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PET_FIGURES } from "@agentherd/host/api";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../src/renderer/src/pet/figures");
const NOTICE = readFileSync(join(DIR, "NOTICE.md"), "utf8");
const SOURCES = readFileSync(join(DIR, "../figures.ts"), "utf8");

describe("the pet's figures (ADR 0070, ADR 0092)", () => {
  it("has an atlas for every figure and no atlas without one", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".webp"));
    expect(files.sort()).toEqual(PET_FIGURES.map((f) => `${f}.webp`).sort());
    for (const f of files) expect(statSync(join(DIR, f)).size).toBeGreaterThan(50_000);
  });

  it("writes down where every figure comes from", () => {
    for (const figure of PET_FIGURES) {
      expect(existsSync(join(DIR, `${figure}.webp`))).toBe(true);
      // NOTICE.md has a row for the file with a link to its source folder.
      const row = NOTICE.split("\n").find((line) => line.includes(`\`${figure}.webp\``));
      expect(row, figure).toMatch(/https:\/\/github\.com\/[^)]+\/pets\//);
      // figures.ts gives it a maker, terms and a link.
      expect(SOURCES, figure).toMatch(new RegExp(`\\n  ${figure}: (awesome|llmPet)\\(`));
    }
  });
});
