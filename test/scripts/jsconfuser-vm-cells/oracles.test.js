// The output checks over decoded programs. No encoder runs.
import assert from "node:assert/strict";
import fs from "node:fs";

import { test } from "vitest";
import { inputPath } from "../../vm/jsconfuser-vm/support/cells.js";
import {
  inspectCurrent,
  outputChecks,
} from "../../../scripts/jsconfuser-vm-cells/oracles.mjs";

test("output oracle refuses renamed numeric dispatcher passthrough", () => {
  const input = fs.readFileSync(
    inputPath("constant-arithmetic", "classObfuscation+minify", 169),
    "utf8",
  );
  const emitted = inspectCurrent(input).publicRecord.result;
  const dispatcher =
    "function d(w){let p=0,r=[];while(p<w.length){switch(w[p++]){case 1:r[w[p++]]=w[p++];break;case 2:return r[w[p++]];}}} const tape=[1,0,7,2,0];window.TEST_OUTPUT=d(tape);";
  // Reuse the existing test's current-emission seam. This challenges the output
  // oracle, not a private record guard inside the owned decoder chain.
  const output = `${emitted.output}\n${dispatcher}`;
  const checked = outputChecks(output, input, { ...emitted, output });
  assert.equal(checked.outputIdentity, true);
  assert.equal(checked.recoveredCoverage, true);
  assert.equal(checked.complete, true);
  assert.ok(checked.residue.includes("numeric-stream-dispatch"));
  assert.equal(checked.ok, false);
});

test("actual output structure rejects surviving dispatch and fallback while keeping user switches", () => {
  const input = fs.readFileSync(
      inputPath("constant-arithmetic", "classObfuscation+minify", 169),
      "utf8",
    ),
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
