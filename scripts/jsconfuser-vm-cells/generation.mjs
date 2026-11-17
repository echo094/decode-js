// One encoding by the pinned encoder, reproducible from its seed: `Math.random` is replaced by
// mulberry32 seeded with `request.seed` for the encoding's duration, and minify's Closure Compiler
// runs on the JDK `request.javaRoot` names. Each Closure process is killed after 60 seconds; a
// minify encoding must run exactly one Closure process, which exits 0. Everything replaced is
// restored, also on failure.
const CLOSURE_TIMEOUT_MS = 60000;

export async function generationSession(
  request,
  { loadCompiler, loadEncoder, setTimer = setTimeout, clearTimer = clearTimeout },
) {
  let state = request.seed >>> 0,
    Compiler,
    originalRun;
  const originalRandom = Math.random,
    savedPath = process.env.PATH,
    processes = [];
  function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  }
  try {
    process.env.PATH = `${request.javaRoot}/bin:${savedPath ?? ""}`;
    Compiler = await loadCompiler();
    originalRun = Compiler.prototype.run;
    Compiler.prototype.run = function (callback) {
      const record = { exitCode: null, timedOut: false };
      processes.push(record);
      let timer;
      const child = originalRun.call(this, (exitCode, stdout, stderr) => {
        clearTimer(timer);
        record.exitCode = exitCode;
        callback(exitCode, stdout, stderr);
      });
      timer = setTimer(() => {
        record.timedOut = true;
        child.kill("SIGKILL");
      }, CLOSURE_TIMEOUT_MS);
      return child;
    };
    const encoder = await loadEncoder();
    Math.random = random;
    const result = await encoder.obfuscate(request.source, request.options);
    if (
      request.options.minify &&
      (processes.length !== 1 ||
        processes[0].exitCode !== 0 ||
        processes[0].timedOut)
    )
      throw new Error("Missing unique successful Closure process");
    return { raw: result.code };
  } finally {
    Math.random = originalRandom;
    if (Compiler && originalRun) Compiler.prototype.run = originalRun;
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
}
