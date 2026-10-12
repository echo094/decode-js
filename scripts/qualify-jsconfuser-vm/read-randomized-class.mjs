import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { parseRecord, exactEqual } from './codec.mjs';
import { exceptionExpected } from './qualify.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all)=>index%2?pairs:[...pairs,[value,all[index+1]]],[]));
assert(args['--input']&&args['--output'],'Explicit input/output required');
const root=path.resolve(args['--input']), output=path.resolve(args['--output']);
const read=name=>parseRecord(fs.readFileSync(path.join(root,name),'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const summary=read('summary.json'), manifest=read('population-manifest.json');
assert(summary.completedAt,'Completed publication required');
const found=new Set();
for(const record of manifest){
  assert(!found.has(record.path));found.add(record.path);
  const file=path.join(root,record.path);
  if(record.kind==='symlink')assert.equal(hash(fs.readlinkSync(file)),record.sha256);
  else {const bytes=fs.readFileSync(file);assert.equal(bytes.length,record.bytes);assert.equal(hash(bytes),record.sha256);}
}

const selected=new Set(['randomizeOpcodesClassObfuscation','randomizeOpcodesClassObfuscationMinify']);
const rows=[],counts={};
for(const row of summary.records){
  counts[row.profile]??={};counts[row.profile][row.status]=(counts[row.profile][row.status]??0)+1;
  for(const record of Object.values(row.files)){
    const bytes=fs.readFileSync(path.join(root,record.path));
    assert.equal(bytes.length,record.bytes);assert.equal(hash(bytes),record.sha256);
  }
  const result=read(`${row.id}/result.json`),qualification=read(`${row.id}/qualification.json`);
  assert.equal(result.status,row.status);assert.equal(qualification.status,row.status);
  const source=fs.readFileSync(path.join(root,row.id,'source.js'));
  const encoded=fs.readFileSync(path.join(root,row.id,'encoded.js'));
  assert.equal(hash(source),row.sourceSha256);assert.equal(hash(encoded),row.encodedSha256);
  for(const process of result.processes){
    assert(process.completedAt);assert.equal(process.exitCode,0);assert.equal(process.signal,null);assert.equal(process.timedOut,false);
  }
  if(!selected.has(row.profile))continue;
  assert.equal(row.status,'accepted');assert.equal(row.qualified,true);assert.equal(row.normalizedAgreement,true);
  assert.equal(row.effectObservation.observed,true);
  for(const value of Object.values(row.effectObservation.components))assert.equal(value,true);
  const {inspection,behavior}=result, publicRecord=inspection.publicRecord;
  assert.equal(inspection.A.ok,true);assert.equal(inspection.B.ok,true);
  assert.equal(inspection.B.result.consumedWords,inspection.A.result.roles.words.values.length);
  assert.equal(inspection.inputState,true);assert.equal(inspection.checks.ok,true);
  assert.equal(inspection.checks.derivedState,true);assert.equal(inspection.checks.fresh,true);
  assert.deepEqual(inspection.checks.residue,[]);
  assert.equal(publicRecord.ok,true);assert.equal(publicRecord.result.finalJavaScriptSemantics,false);
  const decoded=fs.readFileSync(path.join(root,row.id,'decoded.js'),'utf8');
  assert.notEqual(decoded,encoded.toString());assert.equal(decoded,publicRecord.output);
  for(const key of ['freshJavaScriptEmission','freshSimplificationState','finalParseValidated','finalResidueValidated'])assert.equal(publicRecord.result.proof[key],true);
  assert(exactEqual(behavior.sourceObservation,behavior.encodedObservation));
  assert(exactEqual(behavior.sourceObservation,behavior.decodedObservation));
  if(row.case==='exceptionRoutes')assert(exactEqual(behavior.decodedObservation,{kind:'value',value:exceptionExpected}));
  rows.push({id:row.id,normalizedAgreement:true,effects:row.effectObservation,consumedWords:inspection.B.result.consumedWords,
    freshRecovered:true,derivedState:true,residue:[],behavior:behavior.decodedObservation,finalJavaScriptSemantics:false,
    processes:result.processes.map(p=>({pid:p.pid,startedAt:p.startedAt,completedAt:p.completedAt,exitCode:p.exitCode,signal:p.signal,timedOut:p.timedOut}))});
}
assert.equal(rows.length,18);
const result={completedAt:new Date().toISOString(),publicationCompletedAt:summary.completedAt,
  summarySha256:hash(fs.readFileSync(path.join(root,'summary.json'))),populationManifestSha256:hash(fs.readFileSync(path.join(root,'population-manifest.json'))),
  counts,rows,boundary:'Readback of current finite randomized class pair/triple; no broader semantic equivalence'};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({completedAt:result.completedAt,counts,acceptedTargetCells:rows.length}));
