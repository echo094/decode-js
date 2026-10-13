import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";
import {
  emittedOptionEffect,
  eligibleEffectControl,
  assertStableExecutionInputs,
  parseArgs,
  runWorker,
} from "../../../scripts/qualify-jsconfuser-vm/qualify.mjs";
import { generationSession } from "../../../scripts/qualify-jsconfuser-vm/generation.mjs";
import { profiles } from "../../../scripts/qualify-jsconfuser-vm/config.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const fixture = (relative) =>
  fs.readFileSync(
    new URL(
      `../../../test/vm/jsconfuser-vm/fixtures/${relative}/encoded.js`,
      import.meta.url,
    ),
    "utf8",
  );

test("compound effect without component controls is unavailable", () => {
  const effect = emittedOptionEffect(
    "stringConcealingControlFlowFlattening",
    "var BYTECODE = [1];",
    "var BYTECODE = [2];",
    new Map(),
  );
  assert.equal(effect.observed, null);
  assert.deepEqual(effect.components, {
    stringConcealing: null,
    controlFlowFlattening: null,
  });
});

test("an observed absent component fails a compound effect despite a missing control", () => {
  const effect = emittedOptionEffect(
    "minifyEncodeBytecode",
    "baseline",
    "candidate",
    new Map([["minify", "control"]]),
  );
  assert.equal(effect.components.minify, null);
  assert.equal(effect.components.encodeBytecode, false);
  assert.equal(effect.observed, false);
});

test("self-modifying controls distinguish proved absence from an observer decline", () => {
  const candidate = fixture("self-modifying-boot");
  const noPatch = fixture("corpus/raw/f-literals-order");
  const unsupported = fixture("anti-runtime-boot");
  const effect = (control) =>
    emittedOptionEffect(
      "minifySelfModifying",
      noPatch,
      candidate,
      new Map([
        ["minify", control],
        ["selfModifying", `${candidate} `],
      ]),
    );
  assert.equal(effect(noPatch).components.selfModifying, true);
  assert.equal(effect(unsupported).components.selfModifying, null);
  assert.equal(effect(unsupported).observed, null);
});

test("compound effects require every observed component", () => {
  const effect = emittedOptionEffect(
    "minifyEncodeBytecode",
    "baseline",
    "new Uint32Array(1)",
    new Map([
      ["encodeBytecode", "a".repeat(100)],
      ["minify", "plain runtime"],
    ]),
  );
  assert.deepEqual(effect.components, { minify: true, encodeBytecode: true });
  assert.equal(effect.observed, true);
});

test("encoder failures cannot supply representation controls", () => {
  for (const status of ["encoder-mismatch", "generation-error"])
    assert.equal(eligibleEffectControl({ encoded: true, status }), false);
  assert.equal(eligibleEffectControl({ status: "accepted" }), false);
  for (const status of ["accepted", "declined", "decoder-mismatch"])
    assert.equal(eligibleEffectControl({ encoded: true, status }), true);
});

test("publication refuses changed bytes, revisions, pin or relevant worktree state", () => {
  const before = {
    encoderCommit: "encoder",
    decoderCommit: "decoder",
    decoderSourceTree: "tree",
    encoderWorktreeStatus: "",
    decoderWorktreeStatus: " M src/main.js",
    decoderUncommittedSha256: "delta",
    tools: { commit: "decoder", status: "", uncommittedSha256: null },
  };
  assert.doesNotThrow(() =>
    assertStableExecutionInputs(before, structuredClone(before)),
  );
  for (const key of Object.keys(before)) {
    const after = structuredClone(before);
    after[key] = "changed";
    assert.throws(
      () => assertStableExecutionInputs(before, after),
      /inputs or repository state changed/,
    );
  }
});

import {
  tagged,
  exactEqual,
  stringifyRecord,
  parseRecord,
} from "../../../scripts/qualify-jsconfuser-vm/codec.mjs";
import {
  classLayoutEffect,
  runtimeLayout,
} from "../../../scripts/qualify-jsconfuser-vm/layout.mjs";
import {
  inspectCurrent,
  outputChecks,
  assessCurrent,
} from "../../../scripts/qualify-jsconfuser-vm/oracles.mjs";
import { replayOutputAllowed, verifyFrozen } from "../../../scripts/qualify-jsconfuser-vm/qualify.mjs";
import path from "node:path";
import os from "node:os";
import {
  manifest,
  auditEntries,
  decoderRoot,
} from "../../../scripts/qualify-jsconfuser-vm/audit.mjs";
import { parse } from "../../../node_modules/@babel/parser/lib/index.js";
import {
  cellSummary,
  finalizeCells,
  assertRecoveryBoundary,
  recoveryRows,
  verifyRawPopulation,
  assertStoredDisposition,
} from "../../../scripts/qualify-jsconfuser-vm/finalize.mjs";
import { sha256 } from "../../../scripts/qualify-jsconfuser-vm/audit.mjs";
import traverse from "../../../node_modules/@babel/traverse/lib/index.js";
import generate from "../../../node_modules/@babel/generator/lib/index.js";
import { damageControls } from "../../../scripts/qualify-jsconfuser-vm/damage.mjs";

const read = (relative) =>
  fs.readFileSync(
    new URL(
      `../../../test/vm/jsconfuser-vm/fixtures/${relative}`,
      import.meta.url,
    ),
    "utf8",
  );
test("lossless analysis codec separates undefined/null, holes and numeric exceptional values", () => {
  for (const [left, right] of [
    [[undefined], [null]],
    [{ x: undefined }, {}],
    [-0, 0],
    [NaN, null],
    [new Array(1), [undefined]],
  ])
    assert.equal(exactEqual(left, right), false);
  const value = {
    pool: [undefined, null, NaN, -0, Infinity, -Infinity],
    map: new Map([[undefined, 7n]]),
    set: new Set([null, undefined]),
    hole: new Array(1),
    tagShape: ["undefined"],
  };
  assert.equal(exactEqual(value, parseRecord(stringifyRecord(value))), true);
  assert.deepEqual(tagged(value.pool)[2][0][1], ["undefined"]);
  assert.throws(() => tagged(new Date()), /Opaque/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => tagged(cyclic), /Cyclic/);
});
test("minified class has a binding-connected class witness independent of minify compression", () => {
  const plain = read("minified-runtime-boot/encoded.js");
  assert.equal(runtimeLayout(plain).optionalSlotGuards, 9);
  for (const seed of [169, 170, 171]) {
    const candidate = read(`minified-class-boot/encoded-${seed}.js`);
    const witness = classLayoutEffect(plain, candidate);
    assert.equal(witness.observed, true);
    assert.equal(witness.witness, "connected-optional-slots-erased");
    assert.equal(witness.candidate.optionalSlotGuards, 0);
    const effect = emittedOptionEffect(
      "minifyClassObfuscation",
      plain,
      candidate,
      new Map([
        ["minify", plain],
        ["classObfuscation", candidate + " ".repeat(10000)],
      ]),
    );
    assert.deepEqual(effect.components, {
      minify: true,
      classObfuscation: true,
    });
    assert.equal(
      effect.classWitness.witness,
      "connected-optional-slots-erased",
    );
    assert.equal(effect.observed, true);
    assert.equal(classLayoutEffect(candidate, candidate).observed, false);
    assert.equal(
      classLayoutEffect("unrecognized source", candidate).observed,
      null,
    );
    assert.equal(
      emittedOptionEffect("minifyClassObfuscation", plain, candidate, new Map())
        .observed,
      null,
    );
  }
});
test("compression cannot supply the missing or absent class component", () => {
  const plain = read("minified-runtime-boot/encoded.js");
  const effect = emittedOptionEffect(
    "minifyClassObfuscation",
    plain,
    plain,
    new Map([
      ["minify", plain],
      ["classObfuscation", plain + " "],
    ]),
  );
  assert.equal(effect.components.minify, true);
  assert.equal(effect.components.classObfuscation, false);
  assert.equal(effect.observed, false);
});
test("class effect follows binding alpha and refuses disconnected payloads", () => {
  const plain = read("minified-runtime-boot/encoded.js"),
    candidate = read("minified-class-boot/encoded-169.js");
  const ast = parse(candidate);
  let index = 0;
  traverse(ast, {
    Scopable(path) {
      for (const name of Object.keys(path.scope.bindings))
        path.scope.rename(name, `alpha_${index++}`);
    },
  });
  assert.deepEqual(runtimeLayout(generate(ast).code), runtimeLayout(candidate));
  assert.equal(classLayoutEffect(plain, generate(ast).code).observed, true);
  // Removing the actual boot call leaves a real payload/constructor but severs
  // its dispatch receiver connection. A disconnected shape supplies no witness.
  const disconnected = parse(candidate);
  disconnected.program.body.pop();
  assert.equal(runtimeLayout(generate(disconnected).code), null);
  assert.equal(
    classLayoutEffect(plain, generate(disconnected).code).observed,
    null,
  );
  const removed = emittedOptionEffect(
    "minifyClassObfuscation",
    plain,
    plain,
    new Map([["classObfuscation", plain + " "]]),
  );
  assert.equal(removed.components.minify, true);
  assert.equal(removed.components.classObfuscation, null);
  assert.equal(removed.observed, null);
});
test("native test bodies stay outside the parser-only closure audit", () => {
  for (const file of [
    "class-runtime-contract.test.js",
    "runtime-binding-identities.test.js",
    "owned-chain-source.test.js",
  ])
    assert.throws(
      () =>
        auditEntries([path.join(decoderRoot, "test/vm/jsconfuser-vm", file)]),
      /Unreviewed import|Execution surface/,
    );
});
test("retained exception controls reach all eleven named normal-entry refusals without target execution", () => {
  for (const seed of [169, 170, 171]) {
    const result = damageControls(
      read(`minified-class-runtime/exceptions/encoded-${seed}.js`),
    );
    assert.equal(
      result.ok,
      true,
      JSON.stringify(
        result.controls.map(({ name, ok, expected, diagnostic, error }) => ({
          name,
          ok,
          expected,
          diagnostic,
          error,
        })),
      ),
    );
    assert.equal(result.controls.length, 11);
    for (const control of result.controls) {
      assert.equal(control.ok, true);
      assert.equal(control.reached, true);
      assert.equal(control.atomic, true);
      assert.equal(control.wrongExpectedRejected, true);
      assert.ok(control.source);
    }
  }
});
test("supplied current observations are reused losslessly and expected undefined is an oracle", async () => {
  const inspected = inspectCurrent(read("minified-class-boot/encoded-169.js"));
  let count = 0;
  const result = await assessCurrent(
    inspected,
    "source",
    {
      encoded: "encoded",
      sourceObservation: { kind: "value", value: undefined },
      encodedObservation: { kind: "value", value: undefined },
      value: undefined,
    },
    () => {
      count++;
      return { kind: "value", value: null };
    },
  );
  assert.equal(count, 1);
  assert.equal(result.status, "behavior-mismatch");
  assert.equal(result.qualified, false);
});
test("current public parser replay never credits historical good output as native behavior", async () => {
  const encoded = read("minified-class-boot/encoded-169.js");
  const inspected = inspectCurrent(encoded);
  assert.equal(inspected.publicRecord.ok, true);
  assert.equal(inspected.checks.ok, true);
  assert.equal(inspected.inputState, true);
  assert.equal(inspected.projection.constants.includes(undefined), true);
  assert.equal(
    exactEqual(inspected, parseRecord(stringifyRecord(inspected))),
    true,
  );
  const parser = await assessCurrent(
    inspected,
    read("minified-class-boot/source.js"),
    { encoded },
    null,
  );
  assert.equal(parser.status, "parser-only");
  assert.equal(parser.qualified, false);
  const decline = inspectCurrent(encoded, (source) => ({
    ok: false,
    result: null,
    output: source,
    diagnostic: { code: "deliberate-decline" },
  }));
  const refused = await assessCurrent(decline, "source", { encoded }, () => {
    throw new Error("Decline must not execute any output");
  });
  assert.equal(refused.status, "declined");
  assert.equal(refused.qualified, false);
});
test("replay retains frozen manifests and refuses output paths inside them", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-qualification-test-"));
  try {
    fs.writeFileSync(path.join(root, "source.js"), "source");
    const expected = manifest(root);
    verifyFrozen(root, expected);
    assert.throws(
      () => replayOutputAllowed(root, path.join(root, "revision")),
      /outside/,
    );
    fs.writeFileSync(path.join(root, "source.js"), "changed");
    assert.throws(() => verifyFrozen(root, expected), /changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("codec retains all own data keys and collection extras without invoking accessors", () => {
  for (const value of [
    Object.defineProperty({}, "x", { value: undefined }),
    Object.assign(new Map([[1, undefined]]), { extra: -0 }),
    Object.assign(new Set([NaN]), { extra: null }),
    Object.assign([undefined], { extra: Infinity }),
  ]) {
    const restored = parseRecord(stringifyRecord(value));
    assert.equal(exactEqual(value, restored), true);
    assert.deepEqual(
      Object.getOwnPropertyNames(restored),
      Object.getOwnPropertyNames(value),
    );
    for (const key of Object.getOwnPropertyNames(value))
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(restored, key),
        Object.getOwnPropertyDescriptor(value, key),
      );
  }
  let reads = 0;
  const accessor = Object.defineProperty({}, "x", {
    get() {
      reads++;
      return 1;
    },
  });
  assert.throws(() => stringifyRecord(accessor), /Accessor/);
  assert.equal(reads, 0);
  assert.throws(
    () => tagged(Object.assign(new Map(), { [Symbol("x")]: 1 })),
    /Symbol/,
  );
});
test("general argument defaults and every existing profile remain available without generation", () => {
  const defaults = parseArgs(["--output", "unused"]);
  assert.deepEqual(defaults.seeds, [1, 2, 3]);
  assert.deepEqual(defaults.profiles, Object.keys(profiles));
  assert.deepEqual(
    parseArgs(["--output", "unused", "--profiles", "all"]).profiles,
    Object.keys(profiles),
  );
  for (const profile of Object.keys(profiles))
    assert.deepEqual(
      parseArgs(["--output", "unused", "--profiles", profile]).profiles,
      [profile],
    );
  assert.deepEqual(
    parseArgs([
      "--output",
      "unused",
      "--profiles",
      "baseline,minify,classObfuscation,minifyClassObfuscation",
      "--seeds",
      "172,173,174",
    ]).seeds,
    [172, 173, 174],
  );
});
test("actual output structure rejects surviving dispatch and fallback while keeping user switches", () => {
  const input = read("minified-class-boot/encoded-169.js"),
    current = inspectCurrent(input).publicRecord.result;
  for (const suffix of [
    "function d(w){let p=0;while(p<w.length){switch(w[p++]){case 1:return w[p++];}}}",
    "function f(){let state=0;while(true){switch(state){case 0:state=1;break;case 1:return;}}}",
  ]) {
    const output = current.output + "\n" + suffix;
    const checked = outputChecks(output, input, { ...current, output });
    assert.equal(checked.ok, false);
    assert.ok(checked.residue.length);
  }
  const output =
    current.output +
    "\nswitch(window.userChoice){case 1:window.userFlag=true;break;default:window.userFlag=false;}";
  assert.equal(outputChecks(output, input, { ...current, output }).ok, true);
  assert.equal(
    outputChecks(current.output, input, {
      ...current,
      instructionCount: current.instructionCount + 1,
    }).ok,
    false,
  );
});
test("trusted compiler failure and timeout retain partial RNG and Closure process journal", async () => {
  for (const timeout of [false, true]) {
    const events = [];
    let watchdog;
    class FakeCompiler {
      constructor() {
        this.javaPath = "identified-java";
        this.commandArguments = ["-jar", "identified-jar"];
      }
      run(callback) {
        const child = new EventEmitter();
        child.pid = 42;
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal) => {
          child.emit("close", null, signal);
        };
        child.once("close", (code) =>
          callback(code, "partial stdout", "partial stderr"),
        );
        queueMicrotask(() => {
          child.stdout.write("partial stdout");
          child.stderr.write("partial stderr");
          if (timeout) watchdog();
          else child.emit("close", 7, null);
        });
        return child;
      }
    }
    const original = FakeCompiler.prototype.run;
    const encoder = {
      obfuscate: async () => {
        Math.random();
        return new Promise((resolve, reject) =>
          new FakeCompiler().run(() =>
            reject(new Error("trusted compiler failure")),
          ),
        );
      },
    };
    let error;
    try {
      await generationSession(
        {
          source: "data only",
          options: { minify: true },
          seed: 172,
          javaRoot: "/identified-jdk",
          identities: { java: "identified-java", jar: "identified-jar" },
        },
        {
          emit: (event) => events.push(structuredClone(event)),
          loadCompiler: async () => FakeCompiler,
          loadEncoder: async () => encoder,
          setTimer: (callback) => {
            watchdog = callback;
            return 1;
          },
          clearTimer: () => {},
        },
      );
    } catch (caught) {
      error = caught;
    }
    assert.ok(error);
    assert.equal(error.provenance.rng.draws, 1);
    assert.equal(FakeCompiler.prototype.run, original);
    const finish = events.find(
      (event) => event.event === "closure-finish",
    ).process;
    assert.deepEqual(finish.argv, ["-jar", "identified-jar"]);
    assert.equal(finish.stdout, "partial stdout");
    assert.equal(finish.stderr, "partial stderr");
    assert.equal(finish.timedOut, timeout);
    assert.equal(finish.signal, timeout ? "SIGKILL" : null);
    assert.equal(finish.exitCode, timeout ? null : 7);
    assert.ok(events.some((event) => event.event === "rng-draw"));
    assert.ok(events.some((event) => event.event === "generation-error"));
  }
});
test("trusted parent watchdog preserves durable partial generation journal and signal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-journal-control-"));
  const journalPath = path.join(root, "journal.ndjson");
  fs.writeFileSync(journalPath, "");
  try {
    let watchdog, killed, spawned;
    const spawnWorker = () => {
      const child = new EventEmitter();
      spawned = child;
      child.pid = 43;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin.once("finish", () => {
        fs.appendFileSync(journalPath, '{"event":"rng-draw","draws":3}\n');
        child.stdout.write("partial record");
        child.stderr.write("partial diagnostic");
        watchdog();
      });
      return child;
    };
    const result = await runWorker({ action: "generate", journalPath }, 65000, {
      spawnWorker,
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
    assert.equal(result.ok, false);
    assert.equal(killed, 43);
    assert.equal(result.process.timedOut, true);
    assert.equal(result.process.signal, "SIGKILL");
    assert.match(result.process.journal, /draws/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pre-import generation failure retains identities and zero-draw provenance", async () => {
  const events = [];
  let error;
  try {
    await generationSession(
      {
        seed: 174,
        javaRoot: "/identified-jdk",
        identities: { java: "java-sha", jar: "jar-sha" },
      },
      {
        emit: (event) => events.push(event),
        loadCompiler: async () => {
          throw new Error("trusted import refusal");
        },
        loadEncoder: async () => {
          throw new Error("Must not reach encoder");
        },
      },
    );
  } catch (caught) {
    error = caught;
  }
  assert.equal(error.message, "trusted import refusal");
  assert.equal(error.provenance.rng.draws, 0);
  assert.deepEqual(error.provenance.processes, []);
  assert.deepEqual(events[0].identities, { java: "java-sha", jar: "jar-sha" });
  assert.equal(events.at(-1).event, "generation-error");
});
test("trusted worker spawn error retains close disposition rather than an early partial record", async () => {
  const spawnWorker = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.emit("error", new Error("trusted spawn refusal"));
      child.emit("close", -2, null);
    });
    return child;
  };
  const result = await runWorker({ action: "inspect" }, 20000, {
    spawnWorker,
    setTimer: () => 1,
    clearTimer: () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.process.exitCode, -2);
  assert.equal(result.process.signal, null);
  assert.equal(result.process.timedOut, false);
  assert.equal(result.error.message, "trusted spawn refusal");
  assert.equal(result.process.stdout, "");
  assert.equal(result.process.stderr, "");
});

test("bounded finalization publishes references without retaining inspection or process records", () => {
  const rows = [];
  for (let caseIndex = 0; caseIndex < 14; caseIndex++)
    for (const seed of [172, 173, 174])
      for (const profile of [
        "baseline",
        "minify",
        "classObfuscation",
        "minifyClassObfuscation",
      ])
        rows.push({
          id: `${caseIndex}--${profile}--${seed}`,
          case: String(caseIndex),
          profile,
          seed,
          options: { profile },
          status: "accepted",
          qualified: true,
          encoded: true,
        });
  let reads = 0,
    writes = 0;
  const completed = finalizeCells(rows, {
    readCell: (row) => {
      reads++;
      return {
        ...row,
        inspection: {
          projection: { constants: [undefined, null, NaN, -0] },
          analysis: "large analysis".repeat(10000),
        },
        processes: [{ stdout: "large output".repeat(10000) }],
      };
    },
    readEncoded: (row) => (row.profile === "baseline" ? "x".repeat(1000) : "x"),
    eligible: eligibleEffectControl,
    writeCell: (row, record) => {
      writes++;
      assert.equal(record.normalizedAgreement, true);
      assert.equal(
        record.qualified,
        ["baseline", "minify"].includes(row.profile),
      );
      return { result: { path: `${row.id}/result.json`, sha256: "retained" } };
    },
  });
  assert.equal(writes, 168);
  assert.equal(reads, 210);
  assert.ok(stringifyRecord(completed).length < 1000000);
  assert.equal(JSON.stringify(completed).includes("large analysis"), false);
  assert.equal(JSON.stringify(completed).includes("large output"), false);
  assert.deepEqual(
    completed.map((row) => row.id),
    rows.map((row) => row.id),
  );
});

test("finalization rejects changed cell identities and distinguishes exceptional pool values", () => {
  const baseline = {
    id: "b",
    case: "c",
    seed: 1,
    profile: "baseline",
    qualified: true,
  };
  const candidate = { ...baseline, id: "m", profile: "minify" };
  const run = (value, changed = false) =>
    finalizeCells([baseline, candidate], {
      readCell: (row) => ({
        ...row,
        ...(changed && row === candidate ? { seed: 2 } : {}),
        inspection: {
          projection: {
            constants: [row === baseline ? undefined : value, -0, NaN],
          },
        },
      }),
      readEncoded: () => "data",
      eligible: () => false,
      writeCell: () => ({}),
    });
  assert.equal(run(undefined)[1].normalizedAgreement, true);
  assert.equal(run(null)[1].normalizedAgreement, false);
  assert.throws(() => run(undefined, true), /metadata changed/);
  assert.throws(() => finalizeCells([baseline, baseline], {}), /Duplicate/);
  const current = run(undefined)[0];
  assert.doesNotThrow(() =>
    assertStoredDisposition(current, structuredClone(current)),
  );
  for (const change of [
    { qualified: false },
    { status: "declined" },
    { normalizedAgreement: null },
  ])
    assert.throws(
      () => assertStoredDisposition(current, { ...current, ...change }),
      /differs from original/,
    );
});

test("recovery requires the exact aborted-run manifest and unchanged mechanism boundary", () => {
  const original = {
    decoderCommit: "decoder",
    decoderSourceTree: "tree",
    node: "node",
    tools: { commit: "decoder", status: "", uncommittedSha256: null },
  };
  const raw = stringifyRecord([{ path: "cell/result.json", sha256: "raw" }]);
  const preparation = {
    originalExitCode: 134,
    originalPublication: "absent",
    identical: true,
    before: original,
    current: structuredClone(original),
    rawManifestSha256: sha256(raw),
  };
  const current = structuredClone(original);
  // A committed recovery-tool fix moves the decoder commit with the tools commit.
  current.decoderCommit = "recovery";
  current.tools = {
    commit: "recovery",
    status: " M scripts/qualify-jsconfuser-vm/finalize.mjs",
    uncommittedSha256: "delta",
  };
  const recoveryTools = [
    "scripts/qualify-jsconfuser-vm/finalize.mjs",
    "scripts/qualify-jsconfuser-vm/qualify.mjs",
  ];
  assert.doesNotThrow(() =>
    assertRecoveryBoundary(original, preparation, current, raw, recoveryTools),
  );
  for (const [mutate, changed] of [
    [(value) => (value.decoderSourceTree = "changed"), recoveryTools],
    [(value) => (value.node = "changed"), recoveryTools],
    [() => {}, [...recoveryTools, "scripts/qualify-jsconfuser-vm/oracles.mjs"]],
  ]) {
    const wrong = structuredClone(current);
    mutate(wrong);
    assert.throws(
      () => assertRecoveryBoundary(original, preparation, wrong, raw, changed),
      /boundary changed|unrelated tool/,
    );
  }
  const dirty = { ...original, tools: { ...original.tools, status: " M x" } };
  assert.throws(
    () =>
      assertRecoveryBoundary(
        dirty,
        { ...preparation, before: dirty, current: dirty },
        current,
        raw,
        [],
      ),
    /original tools committed/,
  );
  assert.throws(
    () => assertRecoveryBoundary(original, preparation, current, raw + " ", []),
    /preparation/,
  );
  assert.throws(
    () =>
      assertRecoveryBoundary(
        original,
        { ...preparation, originalExitCode: 0 },
        current,
        raw,
        [],
      ),
    /preparation/,
  );
  assert.throws(
    () => parseArgs(["--recover", "raw", "--output", "new"]),
    /requires frozen/,
  );
  assert.throws(
    () => parseArgs(["--output", "new", "--raw-manifest", "m"]),
    /requires --recover/,
  );
});

test("synthetic recovery census rejects incomplete, changed and excess raw cells", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-recovery-control-"));
  try {
    const id = "c--baseline--172",
      directory = path.join(root, id);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "source.js"), "source");
    const row = {
      id,
      case: "c",
      profile: "baseline",
      seed: 172,
      options: {},
      status: "declined",
      qualified: false,
    };
    for (const name of ["result.json", "qualification.json"])
      fs.writeFileSync(path.join(directory, name), stringifyRecord(row));
    const population = {
      sources: { c: "source" },
      profiles: [{ name: "baseline", options: {} }],
      seeds: [172],
    };
    const expected = manifest(root);
    verifyRawPopulation(root, expected);
    assert.deepEqual(recoveryRows(root, population, expected), [
      cellSummary(row),
    ]);
    assert.throws(
      () =>
        recoveryRows(
          root,
          population,
          expected.filter(
            (member) => !member.path.endsWith("qualification.json"),
          ),
        ),
      /Incomplete/,
    );
    assert.throws(
      () => recoveryRows(root, { ...population, seeds: [173] }, expected),
      /Incomplete/,
    );
    assert.throws(
      () =>
        recoveryRows(root, population, [
          ...expected,
          { path: "extra/result.json" },
        ]),
      /census/,
    );
    fs.writeFileSync(path.join(directory, "source.js"), "changed");
    assert.throws(
      () => verifyRawPopulation(root, expected),
      /population changed/,
    );
    assert.throws(() => recoveryRows(root, population, expected), /mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
