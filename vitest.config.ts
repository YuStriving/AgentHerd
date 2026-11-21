import { defineConfig } from "vitest/config";

// CI machines (Windows above all) are slow to create files and start processes; a test that takes
// 1 s here can take 5 s there. Locally the 5 s default stays, so a slow test is still noticed.
const ci = process.env.CI === "true";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "scripts/test/**/*.test.ts",
    ],
    testTimeout: ci ? 15_000 : 5_000,
    hookTimeout: ci ? 30_000 : 10_000,
  },
});
