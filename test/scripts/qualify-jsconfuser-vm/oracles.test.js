// Pure codec, oracle and replay-output challenges for the qualifier. No target or encoder executes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  exactEqual,
  parseRecord,
  stringifyRecord,
} from "../../../scripts/qualify-jsconfuser-vm/codec.mjs";
import {
  inspectCurrent,
  outputChecks,
} from "../../../scripts/qualify-jsconfuser-vm/oracles.mjs";
import { replayOutputAllowed } from "../../../scripts/qualify-jsconfuser-vm/qualify.mjs";

test("lossless codec preserves nonenumerable own string keys", () => {
  const value = Object.defineProperty({}, "x", { value: undefined });
  assert.equal(exactEqual(value, {}), false);
  assert.deepEqual(
    Object.getOwnPropertyNames(parseRecord(stringifyRecord(value))),
    ["x"],
  );
});

test("output oracle refuses renamed numeric dispatcher passthrough", () => {
  const fixture = fs.readFileSync(
    new URL(
      "../../../test/vm/jsconfuser-vm/fixtures/minified-class-boot/encoded-169.js",
      import.meta.url,
    ),
    "utf8",
  );
  const emitted = inspectCurrent(fixture).publicRecord.result;
  const dispatcher =
    "function d(w){let p=0,r=[];while(p<w.length){switch(w[p++]){case 1:r[w[p++]]=w[p++];break;case 2:return r[w[p++]];}}} const tape=[1,0,7,2,0];window.TEST_OUTPUT=d(tape);";
  // Reuse the existing test's current-emission seam. This challenges the output
  // oracle, not a private record guard inside the owned decoder chain.
  const output = `${emitted.output}\n${dispatcher}`;
  const checked = outputChecks(output, fixture, { ...emitted, output });
  assert.equal(checked.outputIdentity, true);
  assert.equal(checked.recoveredCoverage, true);
  assert.equal(checked.complete, true);
  assert.ok(checked.residue.includes("numeric-stream-dispatch"));
  assert.equal(checked.ok, false);
});

test("replay path isolation resolves symlink ancestors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vm-admission-review-"));
  try {
    const frozen = path.join(root, "frozen");
    fs.mkdirSync(frozen);
    fs.symlinkSync(frozen, path.join(root, "alias"));
    assert.throws(
      () => replayOutputAllowed(frozen, path.join(root, "alias", "revision")),
      /outside/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
