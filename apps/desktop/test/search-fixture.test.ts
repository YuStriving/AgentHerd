import { expect, it } from "vitest";
import { runSearchFixture } from "./search-fixture.js";

const run = (script: string) =>
  runSearchFixture(process.execPath, ["-e", script], process.env, 3_000);

it("returns the result of a fixture that exits normally", async () => {
  await expect(run(`console.log('SEARCH_RESULT "ready"')`)).resolves.toBe("ready");
});

it("returns a slow fixture's result only once its process is gone", async () => {
  const pid = await run(`console.log('SEARCH_RESULT ' + process.pid); setInterval(() => {}, 100);`);
  expect(typeof pid).toBe("number");
  expect(() => process.kill(pid as number, 0)).toThrow(/ESRCH/);
});

it.runIf(process.platform === "win32")("waits for the fixture's own exit on Windows", async () => {
  await expect(
    run(`console.log('SEARCH_RESULT 42'); setTimeout(() => { process.exitCode = 7 }, 1250)`),
  ).rejects.toThrow("Fixture exited abnormally (7)");
});

it("reports an early abnormal exit even if a helper keeps the pipes open", async () => {
  const script = `
    require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], {
      stdio: ['ignore', 1, 2],
    }).unref();
    process.exitCode = 7;
  `;
  await expect(
    runSearchFixture(process.execPath, ["-e", script], process.env, 1_000),
  ).rejects.toThrow("Fixture exited abnormally (7)");
});

it.each([
  ["missing result", "console.log('ordinary output')", "without a result"],
  ["malformed result", "console.log('SEARCH_RESULT nope')", "Invalid SEARCH_RESULT"],
  [
    "nonzero exit during the grace period",
    "console.log('SEARCH_RESULT 42'); setTimeout(() => { process.exitCode = 7 }, 100)",
    "Fixture exited abnormally (7)",
  ],
  ["no result before timeout", "setInterval(() => {}, 100)", "no result within 3000 ms"],
])("rejects a fixture with %s", async (_reason, script, message) => {
  await expect(run(script)).rejects.toThrow(message);
});
