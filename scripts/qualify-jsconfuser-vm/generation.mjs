import crypto from "node:crypto";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
export async function generationSession(
  request,
  {
    loadCompiler,
    loadEncoder,
    emit,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  },
) {
  let state = request.seed >>> 0,
    draws = 0,
    Compiler,
    originalRun;
  const originalRandom = Math.random,
    savedPath = process.env.PATH,
    processes = [];
  const rng = () => ({
    algorithm: "mulberry32",
    seed: request.seed,
    draws,
    state,
  });
  function random() {
    draws++;
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    emit({ event: "rng-draw", rng: rng() });
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  }
  emit({
    event: "generation-start",
    identities: request.identities,
    rng: rng(),
  });
  try {
    process.env.PATH = `${request.javaRoot}/bin:${savedPath ?? ""}`;
    Compiler = await loadCompiler();
    originalRun = Compiler.prototype.run;
    Compiler.prototype.run = function (callback) {
      const record = {
        id: processes.length,
        executable: this.javaPath,
        argv: [...this.commandArguments],
        startedAt: new Date().toISOString(),
        timeoutMs: 60000,
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        timedOut: false,
      };
      processes.push(record);
      let timer,
        child,
        completed = false;
      emit({
        event: "closure-attempt",
        process: { ...record, argv: [...this.commandArguments] },
        rng: rng(),
      });
      const finish = (exitCode, signal) => {
        if (completed) return;
        completed = true;
        clearTimer(timer);
        Object.assign(record, {
          exitCode,
          signal,
          completedAt: new Date().toISOString(),
          stdoutSha256: hash(record.stdout),
        });
        emit({ event: "closure-finish", process: { ...record }, rng: rng() });
      };
      child = originalRun.call(this, (exitCode, stdout, stderr) => {
        record.stdout = stdout;
        record.stderr = stderr;
        callback(exitCode, stdout, stderr);
      });
      record.argv = [...this.commandArguments];
      record.pid = child.pid;
      emit({ event: "closure-start", process: { ...record }, rng: rng() });
      child.stdout?.on("data", (chunk) => {
        record.stdout += String(chunk);
        emit({ event: "closure-stdout", id: record.id, chunk: String(chunk) });
      });
      child.stderr?.on("data", (chunk) => {
        record.stderr += String(chunk);
        emit({ event: "closure-stderr", id: record.id, chunk: String(chunk) });
      });
      child.once("error", (error) => {
        record.error = { name: error.name, message: error.message };
        emit({ event: "closure-error", process: { ...record }, rng: rng() });
      });
      child.once("close", (code, signal) => finish(code, signal));
      timer = setTimer(() => {
        record.timedOut = true;
        emit({ event: "closure-watchdog", process: { ...record }, rng: rng() });
        child.kill("SIGKILL");
      }, 60000);
      return child;
    };
    const encoder = await loadEncoder();
    Math.random = random;
    const result = await encoder.obfuscate(request.source, request.options);
    // Closure close and callback are delivered in the same event turn by the
    // pinned wrapper. Keep the finish event before final success publication.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (
      request.options.minify &&
      (processes.length !== 1 ||
        processes[0].exitCode !== 0 ||
        processes[0].timedOut)
    )
      throw new Error("Missing unique successful Closure process");
    const resultRecord = { raw: result.code, rng: rng(), processes };
    emit({ event: "generation-success", rng: rng(), processes });
    return resultRecord;
  } catch (error) {
    error.provenance = { rng: rng(), processes };
    emit({
      event: "generation-error",
      error: { name: error.name, message: error.message },
      ...error.provenance,
    });
    throw error;
  } finally {
    Math.random = originalRandom;
    if (Compiler && originalRun) Compiler.prototype.run = originalRun;
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
}
