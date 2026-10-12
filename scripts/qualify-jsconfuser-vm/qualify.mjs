import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  sources,
  baselineOptions,
  profiles,
} from "./config.mjs";
import { emittedOptionEffect } from "./effects.mjs";
import {
  exactEqual,
  parseRecord,
  stringifyRecord,
  CODEC_VERSION,
  tagged,
} from "./codec.mjs";
import {
  assessCurrent,
  PROJECTION_VERSION,
} from "./oracles.mjs";
import {
  snapshot,
  auditEntries,
  changedTools,
  manifest,
  sha256,
  decoderRoot,
  encoderRoot,
  toolFiles,
} from "./audit.mjs";
import {
  cellSummary,
  finalizeCells,
  readCell,
  cellFile,
  assertRecoveryBoundary,
  verifyRawPopulation,
  recoveryRows,
  assertStoredDisposition,
} from "./finalize.mjs";

export { emittedOptionEffect };
export function eligibleEffectControl(record) {
  return (
    record.encoded === true &&
    record.originEffectEligible !== false &&
    ![
      "source-oracle-failed",
      "encoder-mismatch",
      "generation-error",
      "timeout",
    ].includes(record.status)
  );
}
export function assertStableExecutionInputs(before, after) {
  if (!exactEqual(before, after))
    throw new Error(
      "Qualification inputs or repository state changed; rerun with stable inputs",
    );
}
export const exceptionExpected = [
  1,
  2,
  3,
  4,
  [
    "try:0",
    "catch:SyntaxError",
    "finally:0",
    "try:1",
    "catch:TypeError",
    "finally:1",
    "try:2",
    "catch:Error",
    "finally:2",
    "try:3",
    "finally:3",
  ],
];
const strip = (source) => source.replace(/^(?:\/\/[^\n]*\r?\n)+/, "");
export function parseArgs(args) {
  if (args.length === 1 && args[0] === "--audit-only") return { audit: true };
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        "--output",
        "--cases",
        "--profiles",
        "--seeds",
        "--replay",
        "--replay-mode",
        "--recover",
        "--raw-manifest",
        "--recovery-boundary",
      ].includes(args[i]) ||
      !args[i + 1] ||
      values[args[i]]
    )
      throw new Error(
        "Use --audit-only, or --output DIR with approved selection, or --replay DIR --output NEWDIR --replay-mode parser|native",
      );
    values[args[i]] = args[i + 1];
  }
  if (!values["--output"])
    throw new Error("An exclusive output directory is required");
  if (values["--recover"]) {
    if (
      !values["--raw-manifest"] ||
      !values["--recovery-boundary"] ||
      ["--replay", "--replay-mode", "--cases", "--profiles", "--seeds"].some(
        (key) => values[key],
      )
    )
      throw new Error(
        "Recovery requires frozen raw manifest/boundary and an exclusive output only",
      );
    return {
      output: path.resolve(values["--output"]),
      recover: path.resolve(values["--recover"]),
      rawManifest: path.resolve(values["--raw-manifest"]),
      recoveryBoundary: path.resolve(values["--recovery-boundary"]),
    };
  }
  if (values["--raw-manifest"] || values["--recovery-boundary"])
    throw new Error("Recovery evidence requires --recover");
  if (values["--replay"]) {
    if (
      !["parser", "native"].includes(values["--replay-mode"]) ||
      ["--cases", "--profiles", "--seeds"].some((key) => values[key])
    )
      throw new Error(
        "Replay uses the full frozen selection and requires explicit parser/native mode",
      );
    return {
      output: path.resolve(values["--output"]),
      replay: path.resolve(values["--replay"]),
      mode: values["--replay-mode"],
    };
  }
  if (values["--replay-mode"]) throw new Error("Replay mode requires --replay");
  const names = (value, available) => {
    const selected =
      value === "all" ? Object.keys(available) : value.split(",");
    if (
      !selected.length ||
      selected.some((key) => !Object.hasOwn(available, key))
    )
      throw new Error(`Unknown selection ${value}`);
    return [...new Set(selected)];
  };
  const selectedProfiles = names(values["--profiles"] ?? "all", profiles);
  const seeds = (values["--seeds"] ?? "1,2,3").split(",");
  if (
    seeds.some(
      (seed) => !/^(0|[1-9][0-9]*)$/.test(seed) || Number(seed) > 0xffffffff,
    )
  )
    throw new Error("Seeds must be unsigned 32-bit integers");
  return {
    output: path.resolve(values["--output"]),
    cases: names(values["--cases"] ?? "all", sources),
    profiles: selectedProfiles,
    seeds: [...new Set(seeds.map(Number))],
  };
}
function write(file, value) {
  fs.writeFileSync(file, value, { flag: "wx" });
}
function writeRecord(file, record) {
  write(file, stringifyRecord(record));
}
function retainSupportingInputs(output, generation) {
  const directory = path.join(output, "supporting-inputs");
  fs.mkdirSync(directory);
  for (const [name, root] of [
    ["decoder", decoderRoot],
    ...(generation ? [["encoder", encoderRoot]] : []),
  ]) {
    const destination = path.join(directory, name);
    fs.mkdirSync(destination);
    for (const member of [
      "src",
      "node_modules",
      "package.json",
      "pnpm-lock.yaml",
      "package-lock.json",
      "tsconfig.json",
    ]) {
      const source = path.join(root, member);
      if (fs.existsSync(source))
        fs.cpSync(source, path.join(destination, member), {
          recursive: true,
          verbatimSymlinks: true,
          errorOnExist: true,
          force: false,
        });
    }
  }
  const toolsDirectory = path.join(directory, "tools");
  fs.mkdirSync(toolsDirectory);
  for (const file of toolFiles()) {
    fs.mkdirSync(path.dirname(path.join(toolsDirectory, file)), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(decoderRoot, file),
      path.join(toolsDirectory, file),
      fs.constants.COPYFILE_EXCL,
    );
  }
  writeRecord(path.join(directory, "retention.json"), {
    copied:
      "Current decoder sources/dependencies/package metadata and qualifier tooling; generation also retains pinned encoder sources/dependencies/package metadata, including Closure jar.",
    binariesNotArchived: [
      "Node executable",
      "Java executable and JDK runtime libraries",
    ],
    externalDependencyLinks:
      "Manifests identify any dependency symlink outside its copied tree; such targets require separate supply. Internal pnpm target bytes are copied.",
    replay:
      "Frozen source/encoded replay uses the current decoder. Reconstructing generation requires separately supplied identified Node/JDK binaries and any external dependency targets.",
  });
}
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
    const executable = process.execPath,
      argv = [
        fileURLToPath(
          new URL("./worker.mjs", import.meta.url),
        ),
        "--worker",
      ];
    const startedAt = new Date().toISOString();
    const child = spawnWorker(executable, argv, {
      cwd: decoderRoot,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
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
      if (request.journalPath)
        fs.appendFileSync(
          request.journalPath,
          JSON.stringify({
            eventAt: new Date().toISOString(),
            value: tagged({
              event: "parent-watchdog",
              processGroup: child.pid,
              requestedSignal: "SIGKILL",
              closureExit: "unavailable if worker dies before a finish event",
            }),
          }) + "\n",
        );
      try {
        killGroup(child.pid);
      } catch {
        /* The worker may have already exited before the watchdog. */
      }
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimer(timer);
      spawnError = { name: error.name, message: error.message };
    });
    child.once("close", (exitCode, signal) => {
      clearTimer(timer);
      if (request.journalPath)
        fs.appendFileSync(
          request.journalPath,
          JSON.stringify({
            eventAt: new Date().toISOString(),
            value: tagged({
              event: "worker-finish",
              exitCode,
              signal,
              timedOut,
            }),
          }) + "\n",
        );
      const process = {
        executable: path.basename(executable),
        argv: argv.map((value) =>
          path.isAbsolute(value) ? path.relative(decoderRoot, value) : value,
        ),
        cwd: ".",
        startedAt,
        completedAt: new Date().toISOString(),
        timeoutMs,
        exitCode,
        signal,
        timedOut,
        error: spawnError,
        journal:
          request.journalPath && fs.existsSync(request.journalPath)
            ? fs.readFileSync(request.journalPath, "utf8")
            : null,
        stdout,
        stderr,
        stdoutSha256: sha256(stdout),
      };
      try {
        resolve({ ...parseRecord(stdout), process });
      } catch {
        resolve({
          ok: false,
          error: {
            message: timedOut
              ? "Worker timeout"
              : (spawnError?.message ?? "Invalid worker record"),
          },
          process,
        });
      }
    });
  });
}
function audit() {
  const parserEntries = [
    "src/plugin/jsconfuser-vm.js",
    "test/vm/jsconfuser-vm/minified-class-admission.test.js",
    "test/vm/jsconfuser-vm/minified-class-runtime.test.js",
    "test/vm/jsconfuser-vm/minified-class-load-constant.test.js",
    "test/vm/jsconfuser-vm/integration/plugin.test.js",
  ].map((file) => path.join(decoderRoot, file));
  const harnessEntries = [
    "scripts/qualify-jsconfuser-vm/qualify.mjs",
    "scripts/qualify-jsconfuser-vm/worker.mjs",
    "test/scripts/qualify-jsconfuser-vm/qualify.test.js",
    "test/scripts/qualify-jsconfuser-vm/replay.test.js",
  ].map((file) => path.join(decoderRoot, file));
  return {
    parser: auditEntries(parserEntries, {
      external: ["fs", "node:os", "node:path", "node:url"],
    }),
    harness: auditEntries(harnessEntries, {
      native: true,
      external: [
        "node:path",
        "node:url",
        "node:child_process",
        "node:module",
        "node:vm",
        "node:perf_hooks",
        "node:assert/strict",
        "node:os",
        "node:events",
        "node:stream",
      ],
    }),
    encoder: auditEntries([path.join(encoderRoot, "src/index.ts")], {
      native: true,
      external: ["assert", "fs", "module", "path", "google-closure-compiler"],
    }),
    nativeFixture: auditEntries(
      [
        path.join(
          decoderRoot,
          "test/vm/jsconfuser-vm/minified-class-admission.behavior.test.js",
        ),
      ],
      {
        native: true,
        external: [
          "fs",
          "node:vm",
          "node:perf_hooks",
          "node:os",
          "node:path",
          "node:url",
        ],
      },
    ),
    boundary: {
      generation:
        "pinned source type stripping; runtime source is data; Closure Java process",
      decoder: "source data, no target execution",
      behavior:
        "known source in fresh browser-like VM context, 10s per invocation; no Buffer/process/require",
      limits: {
        closure: 60000,
        generation: 65000,
        inspect: 20000,
        behaviorWorker: 12000,
      },
    },
  };
}
export function verifyFrozen(root, expected) {
  assertStableExecutionInputs(
    expected,
    manifest(root).filter(
      (record) => record.path !== "population-manifest.json",
    ),
  );
}
function physicalPath(file) {
  let ancestor = path.resolve(file);
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}
export function replayOutputAllowed(input, output) {
  const relative = path.relative(fs.realpathSync(input), physicalPath(output));
  if (
    !relative ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  )
    throw new Error("Replay output must be outside frozen input");
}

async function qualifyInspection(
  inspected,
  source,
  encoded,
  caseName,
  native,
  processes,
  observations = {},
) {
  if (!native) return assessCurrent(inspected, source, { encoded }, null);
  const observe = async (code) => {
    const worker = await runWorker({ action: "behavior", source: code }, 12000);
    processes.push(worker.process);
    return worker.ok
      ? worker.result
      : {
          kind: worker.process?.timedOut ? "timeout" : "error",
          error: worker.error,
        };
  };
  const sourceObservation =
    observations.sourceObservation ?? (await observe(source));
  const encodedObservation =
    observations.encodedObservation ?? (await observe(encoded));
  if (
    sourceObservation.kind !== "value" ||
    (caseName === "exceptionRoutes" &&
      !exactEqual(sourceObservation.value, exceptionExpected))
  )
    return {
      qualified: false,
      status: "source-oracle-failed",
      sourceObservation,
      encodedObservation,
    };
  if (!exactEqual(sourceObservation, encodedObservation))
    return {
      qualified: false,
      status: "encoder-mismatch",
      sourceObservation,
      encodedObservation,
    };
  return {
    sourceObservation,
    encodedObservation,
    ...(await assessCurrent(
      inspected,
      source,
      {
        encoded,
        sourceObservation,
        encodedObservation,
        ...(caseName === "exceptionRoutes" ? { value: exceptionExpected } : {}),
      },
      observe,
    )),
  };
}
async function main() {
  const args = parseArgs(process.argv.slice(2)),
    audits = audit();
  const before = snapshot({ generation: !args.replay });
  if (args.audit) {
    process.stdout.write(
      JSON.stringify({ audits, snapshot: before }, null, 2) + "\n",
    );
    return;
  }
  if (args.recover) {
    replayOutputAllowed(args.recover, args.output);
    replayOutputAllowed(args.recover, args.rawManifest);
    replayOutputAllowed(args.recover, args.recoveryBoundary);
    const rawBytes = fs.readFileSync(args.rawManifest, "utf8");
    const raw = parseRecord(rawBytes);
    const preparation = parseRecord(
      fs.readFileSync(args.recoveryBoundary, "utf8"),
    );
    const original = parseRecord(
      fs.readFileSync(path.join(args.recover, "execution-inputs.json"), "utf8"),
    );
    if (
      fs.realpathSync(args.recover) !== preparation.originalRoot ||
      fs.existsSync(path.join(args.recover, "summary.json")) ||
      fs.existsSync(path.join(args.recover, "population-manifest.json"))
    )
      throw new Error(
        "Recovery requires the identified unpublished original population",
      );
    assertRecoveryBoundary(
      original.before,
      preparation,
      before,
      rawBytes,
      changedTools(original.before.tools.commit),
    );
    verifyRawPopulation(args.recover, raw);
    const population = parseRecord(
      fs.readFileSync(path.join(args.recover, "population.json"), "utf8"),
    );
    const rows = recoveryRows(args.recover, population, raw);
    if (fs.existsSync(args.output))
      throw new Error("Output directory must not exist");
    fs.mkdirSync(args.output, { recursive: true });
    writeRecord(path.join(args.output, "execution-inputs.json"), {
      before,
      audits,
      args,
      codec: CODEC_VERSION,
      projection: PROJECTION_VERSION,
    });
    write(
      path.join(args.output, "original-population-manifest.json"),
      rawBytes,
    );
    writeRecord(path.join(args.output, "original-boundary.json"), preparation);
    retainSupportingInputs(args.output, false);
    const completed = finalizeCells(rows, {
      readCell: (row) => readCell(args.recover, row),
      readEncoded: (row) =>
        fs.readFileSync(path.join(args.recover, row.id, "encoded.js"), "utf8"),
      eligible: eligibleEffectControl,
      writeCell: (row, record) => {
        const historical = readCell(args.recover, row, "qualification.json");
        assertStoredDisposition(record, historical);
        const directory = path.join(args.output, row.id);
        fs.mkdirSync(directory);
        for (const name of ["source.js", "encoded.js"])
          if (fs.existsSync(path.join(args.recover, row.id, name)))
            fs.copyFileSync(
              path.join(args.recover, row.id, name),
              path.join(directory, name),
              fs.constants.COPYFILE_EXCL,
            );
        const references = {
          result: cellFile(args.recover, row.id, "result.json"),
          qualification: cellFile(args.recover, row.id, "qualification.json"),
        };
        writeRecord(path.join(directory, "stored-disposition.json"), {
          ...cellSummary(record),
          originalRoot: args.recover,
          files: references,
        });
        return references;
      },
    });
    verifyRawPopulation(args.recover, raw);
    assertStableExecutionInputs(before, snapshot({ generation: true }));
    writeRecord(path.join(args.output, "summary.json"), {
      schemaVersion: "jsconfuser-vm-qualification.v3",
      populationStatus: "recovered-finalization-of-aborted-run",
      originalRun: {
        root: args.recover,
        exitCode: 134,
        outerProcessEvidence:
          "Tool-observed exit/OOM; exact original outer stdout/stderr bytes were not separately retained",
        publication: "absent",
        manifestSha256: sha256(rawBytes),
      },
      currentNativeReplayRequired: true,
      startedInputs: original.before,
      recoveryInputs: before,
      completedAt: new Date().toISOString(),
      args,
      codec: CODEC_VERSION,
      projection: PROJECTION_VERSION,
      records: completed,
    });
    writeRecord(
      path.join(args.output, "population-manifest.json"),
      manifest(args.output),
    );
    process.stdout.write(
      `Recovered ${completed.length} stored cell dispositions; original run remains aborted; current native replay required\n`,
    );
    return;
  }
  if (args.replay) replayOutputAllowed(args.replay, args.output);
  if (fs.existsSync(args.output))
    throw new Error("Output directory must not exist");
  fs.mkdirSync(args.output, { recursive: true });
  writeRecord(path.join(args.output, "execution-inputs.json"), {
    before,
    audits,
    args,
    codec: CODEC_VERSION,
    projection: PROJECTION_VERSION,
  });
  retainSupportingInputs(args.output, !args.replay);
  const records = [];
  let frozen;
  if (args.replay) {
    const summary = parseRecord(
      fs.readFileSync(path.join(args.replay, "summary.json"), "utf8"),
    );
    const expected = parseRecord(
      fs.readFileSync(
        path.join(args.replay, "population-manifest.json"),
        "utf8",
      ),
    );
    frozen = expected;
    verifyFrozen(args.replay, expected);
    for (const cell of summary.records) {
      const origin = path.join(args.replay, cell.id);
      const source = fs.readFileSync(path.join(origin, "source.js"), "utf8");
      const directory = path.join(args.output, cell.id);
      fs.mkdirSync(directory);
      write(path.join(directory, "source.js"), source);
      const record = {
        id: cell.id,
        case: cell.case,
        profile: cell.profile,
        seed: cell.seed,
        options: cell.options,
        revision: before.decoderCommit,
        originEffectEligible: eligibleEffectControl(cell),
        processes: [],
      };
      const encodedPath = path.join(origin, "encoded.js");
      if (!fs.existsSync(encodedPath)) {
        record.status = "generation-error";
        record.qualified = false;
        records.push(cellSummary(record));
        writeRecord(path.join(directory, "result.json"), record);
        continue;
      }
      const encoded = fs.readFileSync(encodedPath, "utf8");
      write(path.join(directory, "encoded.js"), encoded);
      const inspection = await runWorker(
        { action: "inspect", source: encoded },
        20000,
      );
      record.processes.push(inspection.process);
      if (!inspection.ok) {
        record.status = "inspection-error";
        record.qualified = false;
        record.error = inspection.error;
      } else {
        record.inspection = inspection.result;
        if (inspection.result.publicRecord.ok)
          write(
            path.join(directory, "decoded.js"),
            inspection.result.publicRecord.output,
          );
        Object.assign(
          record,
          await qualifyInspection(
            inspection.result,
            source,
            encoded,
            cell.case,
            args.mode === "native",
            record.processes,
          ),
        );
      }
      record.encoded = true;
      records.push(cellSummary(record));
      writeRecord(path.join(directory, "result.json"), record);
      process.stdout.write(`${record.id}: ${record.status}\n`);
    }
    verifyFrozen(args.replay, frozen);
  } else {
    // Freeze all sources/configuration before the first encoder worker import.
    writeRecord(path.join(args.output, "population.json"), {
      sources: Object.fromEntries(
        args.cases.map((name) => [name, `${sources[name]}\n`]),
      ),
      profiles: args.profiles.map((name) => ({
        name,
        options: { ...baselineOptions, ...profiles[name] },
      })),
      seeds: args.seeds,
    });
    for (const caseName of args.cases)
      for (const profile of args.profiles)
        for (const seed of args.seeds) {
          const source = `${sources[caseName]}\n`,
            options = { ...baselineOptions, ...profiles[profile] },
            id = `${caseName}--${profile}--${seed}`;
          const directory = path.join(args.output, id);
          fs.mkdirSync(directory);
          write(path.join(directory, "source.js"), source);
          const record = {
            id,
            case: caseName,
            profile,
            seed,
            options,
            processes: [],
            qualified: false,
          };
          const sourceBehavior = await runWorker(
            { action: "behavior", source },
            12000,
          );
          record.processes.push(sourceBehavior.process);
          record.sourceObservation = sourceBehavior.ok
            ? sourceBehavior.result
            : { kind: "error", error: sourceBehavior.error };
          if (
            record.sourceObservation.kind !== "value" ||
            (caseName === "exceptionRoutes" &&
              !exactEqual(record.sourceObservation.value, exceptionExpected))
          ) {
            record.status = "source-oracle-failed";
            records.push(cellSummary(record));
            writeRecord(path.join(directory, "result.json"), record);
            continue;
          }
          const journalPath = path.join(directory, "generation-journal.ndjson");
          write(journalPath, "");
          const generation = await runWorker(
            {
              action: "generate",
              journalPath,
              identities: { java: before.java, jar: before.jar },
              source,
              options,
              seed,
            },
            65000,
          );
          record.processes.push(generation.process);
          if (!generation.ok) {
            record.status = generation.process?.timedOut
              ? "timeout"
              : "generation-error";
            record.error = generation.error;
          } else {
            const encoded = strip(generation.result.raw);
            write(
              path.join(directory, "raw-encoded.js"),
              generation.result.raw,
            );
            write(path.join(directory, "encoded.js"), encoded);
            record.encoded = true;
            record.generation = generation.result;
            const encodedBehavior = await runWorker(
              { action: "behavior", source: encoded },
              12000,
            );
            record.processes.push(encodedBehavior.process);
            record.encodedObservation = encodedBehavior.ok
              ? encodedBehavior.result
              : { kind: "error", error: encodedBehavior.error };
            if (
              !exactEqual(record.sourceObservation, record.encodedObservation)
            )
              record.status = "encoder-mismatch";
            else {
              const inspection = await runWorker(
                { action: "inspect", source: encoded },
                20000,
              );
              record.processes.push(inspection.process);
              if (!inspection.ok) {
                record.status = "inspection-error";
                record.error = inspection.error;
              } else {
                record.inspection = inspection.result;
                if (inspection.result.publicRecord.ok)
                  write(
                    path.join(directory, "decoded.js"),
                    inspection.result.publicRecord.output,
                  );
                Object.assign(
                  record,
                  await qualifyInspection(
                    inspection.result,
                    source,
                    encoded,
                    caseName,
                    true,
                    record.processes,
                    record,
                  ),
                );
                if (
                  profile === "minifyClassObfuscation" &&
                  inspection.result.A.ok
                ) {
                  const damages = await runWorker(
                    { action: "damage", source: encoded },
                    20000,
                  );
                  record.processes.push(damages.process);
                  record.damageControls = damages.ok
                    ? damages.result
                    : { ok: false, error: damages.error };
                  writeRecord(
                    path.join(directory, "damage-controls.json"),
                    record.damageControls,
                  );
                  if (
                    !record.damageControls.ok ||
                    (caseName === "exceptionRoutes" &&
                      record.damageControls.controls?.some(
                        (control) => control.unavailable,
                      ))
                  ) {
                    record.qualified = false;
                    record.status = "damage-oracle-failed";
                  }
                }
              }
            }
          }
          records.push(cellSummary(record));
          writeRecord(path.join(directory, "result.json"), record);
          process.stdout.write(`${id}: ${record.status}\n`);
        }
  }
  const completed = finalizeCells(records, {
    readCell: (row) => readCell(args.output, row),
    readEncoded: (row) =>
      fs.readFileSync(path.join(args.output, row.id, "encoded.js"), "utf8"),
    eligible: eligibleEffectControl,
    writeCell: (row, record) => {
      writeRecord(path.join(args.output, row.id, "qualification.json"), record);
      return {
        result: cellFile(args.output, row.id, "result.json"),
        qualification: cellFile(args.output, row.id, "qualification.json"),
      };
    },
  });
  assertStableExecutionInputs(before, snapshot({ generation: !args.replay }));
  writeRecord(path.join(args.output, "summary.json"), {
    schemaVersion: "jsconfuser-vm-qualification.v3",
    startedInputs: before,
    completedAt: new Date().toISOString(),
    args,
    codec: CODEC_VERSION,
    projection: PROJECTION_VERSION,
    records: completed,
  });
  // Exclude the manifest itself: its verified member set is otherwise complete.
  writeRecord(
    path.join(args.output, "population-manifest.json"),
    manifest(args.output),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
