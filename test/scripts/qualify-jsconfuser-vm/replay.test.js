// Native oracle controls: run only after the separately accepted native gate.
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  inspectCurrent,
  assessCurrent,
} from "../../../scripts/qualify-jsconfuser-vm/oracles.mjs";
import { observeKnown } from "../../../scripts/qualify-jsconfuser-vm/worker.mjs";
const root = new URL(
  "../../../test/vm/jsconfuser-vm/fixtures/minified-class-boot/",
  import.meta.url,
);
const source = fs.readFileSync(new URL("source.js", root), "utf8");
const encoded = fs.readFileSync(new URL("encoded-169.js", root), "utf8");
test("historical good output cannot conceal wrong current emitted behavior", async () => {
  const historical = inspectCurrent(encoded).publicRecord;
  assert.equal(observeKnown(historical.output).value, 0);
  const output = `${historical.output}\nwindow.TEST_OUTPUT = "wrong-current-output";`;
  const current = inspectCurrent(encoded, () => ({
    ...historical,
    output,
    result: { ...historical.result, output },
  }));
  assert.equal(current.checks.ok, true);
  assert.equal(current.checks.recoveredCoverage, true);
  const result = await assessCurrent(
    current,
    source,
    { encoded, value: 0 },
    observeKnown,
  );
  assert.equal(result.qualified, false);
  assert.equal(result.status, "behavior-mismatch");
  assert.equal(
    result.behavior.decodedObservation.value,
    "wrong-current-output",
  );
});
test("current decline cannot inherit historical native success", async () => {
  const current = inspectCurrent(encoded, (input) => ({
    ok: false,
    result: null,
    output: input,
    diagnostic: { code: "control-decline" },
  }));
  const result = await assessCurrent(
    current,
    source,
    { encoded, value: 0 },
    () => {
      throw new Error("No target behavior may execute after current decline");
    },
  );
  assert.equal(result.status, "declined");
  assert.equal(result.qualified, false);
});
