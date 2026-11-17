// The generation session and the worker client, over fake compilers and processes. No encoder runs.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "vitest";
import { runWorker } from "../../../scripts/jsconfuser-vm-cells/run-worker.mjs";
import { generationSession } from "../../../scripts/jsconfuser-vm-cells/generation.mjs";

// A Closure Compiler whose process closes with `code`, or never closes until the watchdog kills it.
function fakeCompiler(code) {
  return class FakeCompiler {
    run(callback) {
      const child = new EventEmitter();
      child.kill = (signal) => child.emit("close", null, signal);
      child.once("close", (exit) => callback(exit, "", ""));
      if (code !== "hang") queueMicrotask(() => child.emit("close", code, null));
      return child;
    }
  };
}

async function generate(Compiler, { minify = true, watchdog } = {}) {
  const savedRandom = Math.random;
  const seen = [];
  const encoder = {
    obfuscate: async () => {
      seen.push(Math.random(), Math.random());
      await new Promise((resolve) => new Compiler().run(resolve));
      return { code: "encoded" };
    },
  };
  const outcome = await generationSession(
    { source: "data only", options: { minify }, seed: 172, javaRoot: "/jdk" },
    {
      loadCompiler: async () => Compiler,
      loadEncoder: async () => encoder,
      setTimer: (callback) => {
        if (watchdog) queueMicrotask(callback);
        return 1;
      },
      clearTimer: () => {},
    },
  ).then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
  assert.equal(Math.random, savedRandom);
  return { ...outcome, seen };
}

test("a seed gives the same draws, and the session restores what it replaced", async () => {
  const Compiler = fakeCompiler(0);
  const original = Compiler.prototype.run;
  const first = await generate(Compiler);
  const second = await generate(Compiler);
  assert.deepEqual(first.result, { raw: "encoded" });
  assert.deepEqual(first.seen, second.seen);
  assert.equal(Compiler.prototype.run, original);
});

test("a minify encoding refuses a Closure process that fails or times out", async () => {
  for (const [Compiler, watchdog] of [
    [fakeCompiler(7), false],
    [fakeCompiler("hang"), true],
  ]) {
    const original = Compiler.prototype.run;
    const { error } = await generate(Compiler, { watchdog });
    assert.match(error.message, /Missing unique successful Closure process/);
    assert.equal(Compiler.prototype.run, original);
  }
});

function fakeWorker(onStart) {
  const child = new EventEmitter();
  child.pid = 43;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin.once("finish", () => onStart(child));
  return child;
}

test("the watchdog kills a worker's group and the run keeps its exit", async () => {
  let watchdog, killed, spawned;
  const result = await runWorker({ action: "generate" }, 65000, {
    spawnWorker: () =>
      (spawned = fakeWorker((child) => {
        child.stdout.write("partial record");
        child.stderr.write("partial diagnostic");
        watchdog();
      })),
    killGroup: (pid) => {
      killed = pid;
      queueMicrotask(() => spawned.emit("close", null, "SIGKILL"));
    },
    setTimer: (callback) => {
      watchdog = callback;
      return 1;
    },
    clearTimer: () => {},
  });
  assert.equal(killed, 43);
  assert.deepEqual(result, {
    ok: false,
    error: { message: "Worker timeout" },
    exit: {
      exitCode: null,
      signal: "SIGKILL",
      timedOut: true,
      stderr: "partial diagnostic",
    },
  });
});

test("a worker that cannot spawn resolves its error at close", async () => {
  const result = await runWorker({ action: "generate" }, 20000, {
    spawnWorker: () =>
      fakeWorker((child) => {
        child.emit("error", new Error("spawn refusal"));
        child.emit("close", -2, null);
      }),
    setTimer: () => 1,
    clearTimer: () => {},
  });
  assert.deepEqual(result, {
    ok: false,
    error: { message: "spawn refusal" },
    exit: { exitCode: -2, signal: null, timedOut: false, stderr: "" },
  });
});
