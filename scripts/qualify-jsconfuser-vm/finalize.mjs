import fs from "node:fs";
import path from "node:path";
import { exactEqual, parseRecord } from "./codec.mjs";
import { emittedOptionEffect } from "./effects.mjs";
import { manifest, sha256 } from "./audit.mjs";

// Large inspection/process records belong only in cell files. Summary consumers
// need selection, oracle dispositions and content identities, not copied IR.
export function cellSummary(record) {
  const row = {};
  for (const key of [
    "id",
    "case",
    "profile",
    "seed",
    "options",
    "revision",
    "originEffectEligible",
    "status",
    "qualified",
    "encoded",
    "effectObservation",
    "normalizedAgreement",
  ])
    if (Object.hasOwn(record, key)) row[key] = record[key];
  return row;
}

export function assertStoredDisposition(current, historical) {
  if (!exactEqual(cellSummary(current), cellSummary(historical)))
    throw new Error(
      `Recovered disposition differs from original cell: ${current.id}`,
    );
}

export function finalizeCells(
  rows,
  { readCell, readEncoded, writeCell, eligible },
) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.case}:${row.seed}`;
    const group = groups.get(key) ?? [];
    if (group.some((peer) => peer.profile === row.profile))
      throw new Error("Duplicate case/profile/seed cell");
    group.push(row);
    groups.set(key, group);
  }
  const completed = new Map();
  for (const group of groups.values()) {
    const baselineRow = group.find((row) => row.profile === "baseline");
    // Retain only the baseline projection, not its process stdout and analysis.
    const baseline = baselineRow
      ? readCell(baselineRow).inspection?.projection
      : null;
    const peers = new Map(
      group.filter(eligible).map((row) => [row.profile, readEncoded(row)]),
    );
    for (const row of group) {
      const record = readCell(row);
      if (!exactEqual(cellSummary(record), row))
        throw new Error(`Cell metadata changed: ${row.id}`);
      record.effectObservation = emittedOptionEffect(
        row.profile,
        peers.get("baseline"),
        peers.get(row.profile),
        peers,
      );
      record.normalizedAgreement =
        record.inspection?.projection && baseline
          ? exactEqual(record.inspection.projection, baseline)
          : null;
      record.qualified =
        Boolean(record.qualified) &&
        record.normalizedAgreement === true &&
        (row.profile === "baseline" ||
          record.effectObservation.observed === true);
      const references = writeCell(row, record);
      completed.set(row.id, { ...cellSummary(record), files: references });
    }
  }
  return rows.map((row) => completed.get(row.id));
}

export function readCell(root, row, name = "result.json") {
  return parseRecord(fs.readFileSync(path.join(root, row.id, name), "utf8"));
}

export function cellFile(root, id, name) {
  const file = path.join(root, id, name);
  return {
    path: `${id}/${name}`,
    sha256: sha256(fs.readFileSync(file)),
    bytes: fs.statSync(file).size,
  };
}

const recoveryToolPaths = new Set([
  "scripts/qualify-jsconfuser-vm/qualify.mjs",
  "test/scripts/qualify-jsconfuser-vm/qualify.test.js",
  "scripts/qualify-jsconfuser-vm/finalize.mjs",
]);
// `changed` lists the qualifier tools that differ between the original run's
// commit and the current worktree (`changedTools` in the audit module).
export function assertRecoveryBoundary(
  original,
  preparation,
  current,
  rawManifestBytes,
  changed,
) {
  if (
    preparation.originalExitCode !== 134 ||
    preparation.originalPublication !== "absent" ||
    preparation.identical !== true ||
    !exactEqual(original, preparation.before) ||
    !exactEqual(original, preparation.current) ||
    sha256(rawManifestBytes) !== preparation.rawManifestSha256
  )
    throw new Error(
      "Recovery preparation does not identify the original aborted run",
    );
  const withoutTools = (input) => {
    const boundary = { ...input };
    delete boundary.tools;
    // A recovery tool commit also moves the decoder commit; the src tree in the
    // boundary is what must stay unchanged.
    delete boundary.decoderCommit;
    return boundary;
  };
  if (!exactEqual(withoutTools(original), withoutTools(current)))
    throw new Error("Recovery source/runtime/dependency boundary changed");
  // Only a clean original worktree leaves Git identifying the original tools.
  if (original.tools?.status !== "")
    throw new Error("Recovery needs the original tools committed");
  if (changed.some((file) => !recoveryToolPaths.has(file)))
    throw new Error("Recovery changed an oracle or unrelated tool");
}

export function verifyRawPopulation(root, expected) {
  if (!exactEqual(expected, manifest(root)))
    throw new Error("Frozen raw population changed");
}

export function recoveryRows(root, population, expected) {
  const members = new Map(expected.map((member) => [member.path, member]));
  const rows = [];
  for (const caseName of Object.keys(population.sources))
    for (const profile of population.profiles)
      for (const seed of population.seeds) {
        const id = `${caseName}--${profile.name}--${seed}`;
        for (const name of ["source.js", "result.json", "qualification.json"])
          if (!members.has(`${id}/${name}`))
            throw new Error(`Incomplete raw cell ${id}/${name}`);
        const result = readCell(root, { id });
        if (
          result.id !== id ||
          result.case !== caseName ||
          result.profile !== profile.name ||
          result.seed !== seed ||
          !exactEqual(result.options, profile.options) ||
          fs.readFileSync(path.join(root, id, "source.js"), "utf8") !==
            population.sources[caseName]
        )
          throw new Error(`Raw cell selection/input mismatch: ${id}`);
        if (result.encoded && !members.has(`${id}/encoded.js`))
          throw new Error(`Raw encoded identity mismatch: ${id}`);
        if (
          result.encoded &&
          (!members.has(`${id}/raw-encoded.js`) ||
            !members.has(`${id}/generation-journal.ndjson`) ||
            fs.readFileSync(path.join(root, id, "raw-encoded.js"), "utf8") !==
              (result.generation?.raw ?? ""))
        )
          throw new Error(`Raw generation provenance incomplete: ${id}`);
        rows.push(cellSummary(result));
      }
  const actualResults = expected.filter(
    (member) =>
      member.path.endsWith("/result.json") &&
      !member.path.startsWith("supporting-inputs/"),
  );
  if (actualResults.length !== rows.length)
    throw new Error("Raw cell census mismatch");
  return rows;
}
