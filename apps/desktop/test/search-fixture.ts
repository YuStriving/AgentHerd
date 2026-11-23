import { spawn } from "node:child_process";

const RESULT = "SEARCH_RESULT ";
const QUIT_GRACE_MS = 1_000;
const KILL_GRACE_MS = 5_000;
const MAX_OUTPUT = 1024 * 1024;

// The caller must not remove the page while the child might still be using it.
export class SearchFixtureStillRunning extends Error {}

export function runSearchFixture(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
): Promise<unknown> {
  const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let result: { value: unknown } | undefined;
    let failure: Error | undefined;
    let sentKill = false;
    let stopping = false;
    const deadline = performance.now() + timeout;
    let timer = setTimeout(() => {
      if (!result) failure ??= new Error(`Fixture printed no result within ${timeout} ms`);
      stop();
    }, timeout);

    const stop = () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        child.unref();
        reject(
          new SearchFixtureStillRunning(
            `Could not confirm fixture ${child.pid} has exited after ${KILL_GRACE_MS} ms ` +
              `(result received: ${result !== undefined}; kill sent: ${sentKill}; ` +
              `exit code: ${child.exitCode}; signal: ${child.signalCode}; ` +
              `stdout closed: ${child.stdout?.closed}; stderr closed: ${child.stderr?.closed})`,
            { cause: failure },
          ),
        );
      }, KILL_GRACE_MS);
      // We already have a complete result or a failure. Don't wait on pipes held by helpers.
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        sentKill = child.kill("SIGKILL");
      } catch (cause) {
        failure ??= new Error("Could not terminate the fixture", { cause });
      }
    };

    child.on("error", (error) => {
      failure ??= error;
      if (child.pid !== undefined) stop();
    });
    child.once("exit", (code, signal) => {
      if ((code !== 0 || signal !== null) && !(sentKill && signal === "SIGKILL")) {
        failure ??= new Error(`Fixture exited abnormally (${signal ?? code})`);
        stop();
      }
    });
    child.once("close", () => {
      clearTimeout(timer);
      if (!failure && !result) failure = new Error("Fixture exited without a result");
      if (failure)
        reject(new Error(`${failure.message}${stderr ? `\n${stderr}` : ""}`, { cause: failure }));
      else resolve(result?.value);
    });

    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      if (result || stopping) return;
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) {
        failure = new Error("Fixture stdout exceeded the output limit");
        stop();
        return;
      }
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      const line = lines.find((s) => s.startsWith(RESULT));
      if (line === undefined) return;
      try {
        result = { value: JSON.parse(line.slice(RESULT.length)) };
      } catch (cause) {
        failure = new Error("Invalid SEARCH_RESULT", { cause });
        stop();
        return;
      }
      // On Windows CI a forced exit was still pending after the confirmation window.
      // Let Electron shut down naturally there, up to the original watchdog deadline.
      if (process.platform !== "win32") {
        clearTimeout(timer);
        timer = setTimeout(stop, Math.min(QUIT_GRACE_MS, deadline - performance.now()));
      }
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_OUTPUT);
    });
  });
}
