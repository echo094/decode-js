import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sources, baselineOptions } from './config.mjs';
import { runWorker } from './qualify.mjs';
import { snapshot, PIN } from './audit.mjs';
import { stringifyRecord, exactEqual } from './codec.mjs';
import { diagnoseContainer } from '../../src/vm/jsconfuser-vm/extract-container.js';
import { diagnosePatchAddedOpcodes } from '../../src/vm/jsconfuser-vm/observe-patch-added-opcodes.js';
import { diagnoseSelfModifyingRegions } from '../../src/vm/jsconfuser-vm/observe-self-modifying.js';
import { diagnoseNormalizeSelfModifyingWordcode } from '../../src/vm/jsconfuser-vm/normalize-self-modifying-wordcode.js';

// Fixed pre-generation protocol: all subsets, known sources, fresh mulberry32
// seeds, same-case/seed removal peers, native equality AND current recovery,
// residue and consumed state. Named damage controls are in the focused tests.
// Worker limits: generation 65s, inspection (with the census) 20s, behavior 12s, native VM 10s.
// Cells run PATCH_JOBS at a time (default 4: each worker uses about 1.4 cores, and more jobs only
// slowed every worker); records, summary and stdout keep the fixed case/seed/profile order.
export const patchOptions = ['selfModifying', 'aliasedOpcodes', 'macroOpcodes', 'specializedOpcodes', 'antiInstrumentation'];
export const patchCases = ['arithmetic', 'closures', 'tryFinally', 'patchArrays'];
export const patchSeeds = [211, 212, 213];
export const patchProfiles = Array.from({ length: 1 << patchOptions.length }, (_, mask) => ({
  name: mask === 0 ? 'baseline' : patchOptions.filter((_, bit) => mask & (1 << bit)).join('+'),
  options: Object.fromEntries(patchOptions.map((option, bit) => [option, Boolean(mask & (1 << bit))])),
}));
const kindByOption = { aliasedOpcodes: 'ALIAS', macroOpcodes: 'MACRO', specializedOpcodes: 'SPECIALIZED', antiInstrumentation: 'SYNTHETIC' };
export function patchAddedOpcodeCensus(source) {
  const container = diagnoseContainer(source);
  if (!container.ok) return { ok: false, diagnostic: container.diagnostic };
  const addedOpcodes = diagnosePatchAddedOpcodes(source);
  if (!addedOpcodes.ok) return { ok: false, diagnostic: addedOpcodes.diagnostic };
  const observed = diagnoseSelfModifyingRegions(container.result, addedOpcodes.result, { requirePatch: false });
  if (!observed.ok) return { ok: false, diagnostic: observed.diagnostic };
  const counts = Object.fromEntries(patchOptions.map(option => [option, option === 'selfModifying'
    ? observed.result.patches.length : observed.result.instructions.filter(instruction => instruction.name === kindByOption[option]).length]));
  return { ok: true, counts, emitted: {
    aliasedOpcodes: addedOpcodes.result.alias?.aliases.length ?? 0,
    macroOpcodes: addedOpcodes.result.macro?.macros.length ?? 0,
    specializedOpcodes: addedOpcodes.result.specialized?.specialized.length ?? 0,
    antiInstrumentation: addedOpcodes.result.anti?.syntheticCases.length ?? 0,
  }, patchedKinds: [...new Set(observed.result.patches.flatMap(patch => patch.instructions.map(instruction => instruction.name)))].sort() };
}
// The census and the PATCH normalization run in the inspection worker, so the scheduling
// process stays free.
export function patchCensusOf(source, selfModifying) {
  const census = patchAddedOpcodeCensus(source);
  const container = diagnoseContainer(source);
  const normalization = selfModifying && container.ok
    ? diagnoseNormalizeSelfModifyingWordcode(container.result, { source }) : null;
  return { census, normalizationDiagnostic: normalization?.diagnostic };
}
export function assertNamedPatchDiagnostic(diagnosis, code) {
  if (diagnosis.ok || diagnosis.diagnostic?.code !== code)
    throw new Error(`Expected PATCH mechanism ${code}; observed ${diagnosis.diagnostic?.code ?? 'success'}`);
}
export async function main(args = process.argv.slice(2)) {
  const output = args[0];
  const seeds = args[1] ? args[1].split(',').map(Number) : patchSeeds;
  const cases = args[2] ? args[2].split(',') : patchCases;
  if (!output || seeds.some(seed => !patchSeeds.includes(seed)) || cases.some(name => !patchCases.includes(name)))
    throw new Error('Use patch.mjs OUTPUT [211,212,213] [arithmetic,closures,tryFinally,patchArrays]');
  if (fs.existsSync(output)) throw new Error('Output directory must not exist');
  const before = snapshot({ generation: true });
  fs.mkdirSync(output, { recursive: true });
  const protocol = { pin: PIN, seeds, cases, profiles: patchProfiles, limitsMs: { generation: 65000, inspection: 20000, behavior: 12000, native: 10000 }, inputs: before };
  fs.writeFileSync(path.join(output, 'protocol.json'), stringifyRecord(protocol));
  const records = [];
  const worker = async (request, limit) => {
    const result = await runWorker(request, limit);
    if (!result.ok || result.process.exitCode !== 0 || result.process.timedOut || result.process.signal)
      throw new Error(`Qualification worker failed: ${JSON.stringify(result.error)}`);
    return result;
  };
  const jobs = Math.max(1, Number(process.env.PATCH_JOBS) || 4);
  const pool = async (items, run) => {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (next < items.length) { const index = next++; results[index] = await run(items[index]); }
    }));
    return results;
  };
  const groups = cases.flatMap(caseName => seeds.map(seed => ({ caseName, seed, source: sources[caseName] })));
  const sourceBehaviors = await pool(groups, group => worker({ action: 'behavior', source: group.source }, 12000));
  const cell = async ({ group, sourceBehavior, profile }) => {
    const { caseName, seed, source } = group;
    const name = `${caseName}--${profile.name}--${seed}`;
    const directory = path.join(output, name); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'source.js'), source);
    const journalPath = path.join(directory, 'generation.ndjson'); fs.writeFileSync(journalPath, '');
    const generation = await worker({ action: 'generate', source, options: { ...baselineOptions, ...profile.options }, seed, journalPath, identities: { java: before.java, jar: before.jar } }, 65000);
    const encoded = generation.result.raw.replace(/^(?:\/\/[^\n]*\r?\n)+/, '');
    fs.writeFileSync(path.join(directory, 'encoded.js'), encoded);
    const encodedBehavior = await worker({ action: 'behavior', source: encoded }, 12000);
    const inspected = await worker({ action: 'patch-inspect', source: encoded, selfModifying: profile.options.selfModifying }, 20000);
    const current = inspected.result.inspection;
    const behavior = exactEqual(sourceBehavior.result, encodedBehavior.result) && sourceBehavior.result.kind === 'value';
    const { census, normalizationDiagnostic } = inspected.result;
    let decodedBehavior = null;
    if (current.publicRecord.ok) {
      fs.writeFileSync(path.join(directory, 'decoded.js'), current.publicRecord.output);
      decodedBehavior = await worker({ action: 'behavior', source: current.publicRecord.output }, 12000);
    }
    const recoveryQualified = behavior && current.publicRecord.ok && current.checks.ok && current.inputState
      && exactEqual(sourceBehavior.result, decodedBehavior?.result);
    const record = { name, caseName, seed, profile, census, recoveryQualified, behavior, publicDiagnostic: current.publicRecord.diagnostic, normalizationDiagnostic, checks: current.checks,
      processes: [sourceBehavior.process, generation.process, encodedBehavior.process, inspected.process, ...(decodedBehavior ? [decodedBehavior.process] : [])] };
    fs.writeFileSync(path.join(directory, 'record.json'), stringifyRecord(record));
    const { processes, ...row } = record;
    return { row, line: `${name}: ${recoveryQualified ? 'recovered' : 'finding'} ${normalizationDiagnostic?.code ?? current.publicRecord.diagnostic?.code ?? ''}\n` };
  };
  const cells = groups.flatMap((group, index) => patchProfiles.map(profile => ({ group, sourceBehavior: sourceBehaviors[index], profile })));
  const done = await pool(cells, cell);
  for (const { row, line } of done) { records.push(row); process.stdout.write(line); }
  for (const [index] of groups.entries()) {
    const peers = records.slice(index * patchProfiles.length, (index + 1) * patchProfiles.length);
    for (const record of peers) record.effects = Object.fromEntries(patchOptions.filter(option => record.profile.options[option]).map(option => {
      const peer = peers.find(candidate => patchOptions.every(key => candidate.profile.options[key] === (key === option ? false : record.profile.options[key])));
      return [option, { reached: record.census.ok ? record.census.counts[option] > 0 : null,
        removed: peer?.census.ok && peer.recoveryQualified ? peer.census.counts[option] === 0 : null, removalPeer: peer?.name }];
    }));
  }
  for (const record of records) record.qualified = record.recoveryQualified && Object.values(record.effects).every(effect => effect.reached === true && effect.removed === true);
  const profileWitnesses = Object.fromEntries(patchProfiles.map(profile => [profile.name, records.filter(record => record.profile.name === profile.name && record.qualified).map(record => record.name)]));
  if (!exactEqual(before, snapshot({ generation: true }))) throw new Error('Execution inputs changed during qualification');
  fs.writeFileSync(path.join(output, 'summary.json'), stringifyRecord({ protocol, records, profileWitnesses }));
  if (records.some(record => !record.recoveryQualified) || Object.values(profileWitnesses).some(witnesses => witnesses.length === 0)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
