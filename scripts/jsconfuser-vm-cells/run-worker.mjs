import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseRecord, stringifyRecord } from "./codec.mjs";
import { decoderRoot } from "./audit.mjs";

// Runs one worker request (worker.mjs) in its own process group and resolves its record. A worker
// that outlives `timeoutMs` is killed with its group. A run that leaves no record resolves
// `{ ok: false, error, exit }`: the error, the exit code, the signal, whether the watchdog fired
// and the worker's stderr, which is what a failed generation keeps.
export async function runWorker(
  request,
  timeoutMs,
  {
    spawnWorker = spawn,
    killGroup = (pid) => process.kill(-pid, "SIGKILL"),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  return new Promise((resolve) => {
    const child = spawnWorker(
      process.execPath,
      [fileURLToPath(new URL("./worker.mjs", import.meta.url)), "--worker"],
      { cwd: decoderRoot, detached: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "",
      timedOut = false,
      spawnError = null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => (stdout += value));
    child.stderr.on("data", (value) => (stderr += value));
    child.stdin.on("error", () => {});
    child.stdin.end(stringifyRecord(request));
    const timer = setTimer(() => {
      timedOut = true;
      try {
        killGroup(child.pid);
      } catch {
        /* The worker may have already exited before the watchdog. */
      }
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimer(timer);
      spawnError = error.message;
    });
    child.once("close", (exitCode, signal) => {
      clearTimer(timer);
      try {
        resolve(parseRecord(stdout));
      } catch {
        resolve({
          ok: false,
          error: {
            message: timedOut
              ? "Worker timeout"
              : (spawnError ?? "Invalid worker record"),
          },
          exit: { exitCode, signal, timedOut, stderr },
        });
      }
    });
  });
}
