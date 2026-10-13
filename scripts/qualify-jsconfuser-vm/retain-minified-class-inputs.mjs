import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { javaRoot, decoderRoot, encoderRoot, PIN as encoderPin } from './audit.mjs'

// Audit mode reads source/tooling bytes only. The sole encoder import is behind
// the explicit --generate/--worker switches; neither source nor emitted VM is evaluated.
// Tracked inputs are identified by their Git commits; only untracked bytes
// (installed packages, the JDK, the Closure jar) carry digests.
const outputRoot = path.join(decoderRoot, 'test/vm/jsconfuser-vm/fixtures/minified-class-runtime')
const sources = {
  exceptions: 'function check(value) { try { if (value < 0) throw new Error("negative"); return value + 1; } catch (error) { return error.message; } finally { window.finished = true; } } window.TEST_OUTPUT = [check(-1), check(4), window.finished];\n',
  'nested-strings': 'function outer(prefix) { return function middle(n) { return function inner() { return prefix + ":" + n; }; }; } window.TEST_OUTPUT = outer("id")(7)();\n',
}
const options = Object.freeze({
  randomizeOpcodes: false, shuffleOpcodes: false, encodeBytecode: false,
  concealConstants: false, controlFlowFlattening: false, dispatcher: false,
  stringConcealing: false, macroOpcodes: false, specializedOpcodes: false,
  aliasedOpcodes: false, antiInstrumentation: false, selfModifying: false,
  timingChecks: false, classObfuscation: true, handlerTable: false,
  minify: true, target: 'browser',
})
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
function fileRecord(filename, base = decoderRoot) {
  const bytes = fs.readFileSync(filename)
  return { path: path.relative(base, filename), bytes: bytes.length, sha256: digest(bytes) }
}
function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(root, entry.name)
    if (entry.isDirectory()) return files(item)
    return entry.isFile() ? [item] : []
  }).sort()
}
function localImports(entry) {
  const seen = new Set(), todo = [entry], external = new Set()
  while (todo.length) {
    const filename = todo.pop()
    if (seen.has(filename)) continue
    seen.add(filename)
    const text = fs.readFileSync(filename, 'utf8')
    // The pinned source uses static ESM imports/exports. Audit includes type-only
    // dependencies conservatively; no string or module in this census executes.
    const imports = [...text.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm)]
    for (const [, specifier] of imports) {
      if (specifier.startsWith('.')) todo.push(path.resolve(path.dirname(filename), specifier))
      else external.add(specifier)
    }
    if (/\bimport\s*\(|\brequire\s*\(|\beval\s*\(|\bnew\s+Function\s*\(/.test(text)) {
      throw new Error(`Unreviewed dynamic import/execution boundary in ${filename}`)
    }
  }
  return { files: [...seen].sort().map((f) => path.relative(encoderRoot, f)), external: [...external].sort() }
}
function packageClosure(names) {
  const todo = names, seen = new Set(), result = []
  while (todo.length) {
    const name = todo.pop()
    const root = path.join(encoderRoot, 'node_modules', name)
    if (seen.has(name)) continue
    if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error(`Missing installed dependency ${name}`)
    seen.add(name)
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const manifest = files(root).map((f) => fileRecord(f, root))
    result.push({ name, version: metadata.version, manifest, manifestSha256: digest(JSON.stringify(manifest)) })
    todo.push(...Object.keys(metadata.dependencies || {}))
    // Only present optional binaries matter to this installed closure. The
    // actual encoder call uses Java, recorded separately, without native fallback.
    for (const dependency of Object.keys(metadata.optionalDependencies || {})) {
      if (fs.existsSync(path.join(encoderRoot, 'node_modules', dependency, 'package.json'))) todo.push(dependency)
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}
function gitRead(args) { return execFileSync('git', ['-C', encoderRoot, ...args], {encoding:'utf8',timeout:10000}) }
function checkoutIdentity() {
  const head=gitRead(['rev-parse','HEAD']).trim()
  if(head!==encoderPin) throw new Error('Encoder HEAD does not equal declared pin')
  const status=gitRead(['status','--porcelain=v1','--untracked-files=all'])
  if(status)throw new Error('Encoder checkout is not clean')
  return {head,status}
}
function harnessIdentity() {
  const read=(args)=>execFileSync('git',['-C',decoderRoot,...args],{encoding:'utf8',timeout:10000}).trim()
  const harness=path.relative(decoderRoot,fileURLToPath(import.meta.url))
  return {path:harness,commit:read(['rev-parse','HEAD']),clean:read(['status','--porcelain','--',harness])===''}
}
function snapshot() {
  if (!javaRoot) throw new Error('Needs JAVA_HOME or java on PATH')
  const sourceImports = localImports(path.join(encoderRoot, 'src/index.ts'))
  const dependencies = packageClosure(sourceImports.external.filter((name) => !['assert', 'fs', 'module', 'path'].includes(name)))
  const java = fs.realpathSync(path.join(javaRoot, 'bin/java'))
  return {
    schemaVersion: 'vm-minified-class-source-generation.v1',
    encoderPin, checkout:checkoutIdentity(), encoderImports: sourceImports,
    runtimeText: 'src/runtime.ts',
    harness: harnessIdentity(),
    dependencies,
    node: { version: process.version, executable: 'node', sha256: digest(fs.readFileSync(process.execPath)) },
    java: { executable: 'java', sha256: digest(fs.readFileSync(java)), release: fs.readFileSync(path.join(javaRoot, 'release'), 'utf8') },
    jar: fileRecord(path.join(encoderRoot, 'node_modules/google-closure-compiler-java/compiler.jar'), encoderRoot),
    closureInvocation: { executable: 'java', argv: ['-XX:+IgnoreUnrecognizedVMOptions', '--sun-misc-unsafe-memory-access=allow', '-jar', 'node_modules/google-closure-compiler-java/compiler.jar', '--compilation_level=ADVANCED', '--warning_level=QUIET'], stdin: 'serialized runtime source', stdout: 'emitted source', stderr: 'compiler diagnostics', compilerExit: 'wrapper rejects nonzero exit' },
    options:{...options}, childTimeoutMs:60000, cellTimeoutMs:65000, seeds: [169, 170, 171],
    sources: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, { source, bytes: Buffer.byteLength(source) }])),
    outputRoot: path.relative(decoderRoot, outputRoot),
    limitations: ['Present package/tool identities do not establish historical generation provenance.', 'Tool/dependency/JDK bytes are identified, not archived; future exact regeneration requires these bytes to be supplied.', 'Source-only generation: no input/emitted VM execution, public admission or native equivalence.', 'Installed packages and Closure execute as normal tooling, without a sandbox claim.'],
  }
}
function rng(seed) {
  let state = seed >>> 0, draws = 0
  const random = () => {
    draws++
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }
  return { random, drawCount: () => draws }
}
const mode = process.argv[2]
if (mode === '--worker') {
  const name=process.argv[3],seed=Number(process.argv[4])
  if(process.argv.length!==5||!Object.hasOwn(sources,name)||![169,170,171].includes(seed))throw new Error('Invalid generation worker cell')
  const savedPath=process.env.PATH,savedRandom=Math.random,random=rng(seed)
  const beforeCheckout=checkoutIdentity()
  let Compiler,originalRun
  const processRecords=[]
  try {
    process.env.PATH=`${path.join(javaRoot,'bin')}${path.delimiter}${savedPath||''}`
    ;({default:Compiler}=await import(pathToFileURL(path.join(encoderRoot,'node_modules/google-closure-compiler/lib/node/index.js')).href))
    originalRun=Compiler.prototype.run
    Compiler.prototype.run=function(callback){
      let child,timer
      const startedAt=new Date().toISOString()
      child=originalRun.call(this,(exitCode,stdout,stderr)=>{
        clearTimeout(timer)
        processRecords.push({startedAt,completedAt:new Date().toISOString(),timeoutMs:60000,executable:path.basename(this.javaPath),argv:this.commandArguments.map((value)=>path.isAbsolute(value)?path.relative(encoderRoot,value):value),exitCode,stdoutBytes:Buffer.byteLength(stdout),stderr})
        callback(exitCode,stdout,stderr)
      })
      timer=setTimeout(()=>child.kill('SIGKILL'),60000)
      child.once('close',()=>clearTimeout(timer))
      return child
    }
    const {JsConfuserVM}=await import(pathToFileURL(path.join(encoderRoot,'src/index.ts')).href)
    Math.random=random.random
    const result=await JsConfuserVM.obfuscate(sources[name],{...options})
    if(processRecords.length!==1||processRecords[0].exitCode!==0)throw new Error('Cell has no unique successful Closure process')
    if(typeof result.code!=='string'||!result.code)throw new Error('Encoder returned no source')
    console.log(JSON.stringify({code:result.code,draws:random.drawCount(),processRecords}))
  } finally {
    Math.random=savedRandom
    if(Compiler&&originalRun)Compiler.prototype.run=originalRun
    if(savedPath===undefined)delete process.env.PATH;else process.env.PATH=savedPath
    if(digest(JSON.stringify(beforeCheckout))!==digest(JSON.stringify(checkoutIdentity())))throw new Error('Encoder checkout changed in worker, including on failure')
  }
} else {
  const usage='Use --audit-only, or separately authorized --generate --record <path outside the fixture tree>'
  if(!(mode==='--audit-only'&&process.argv.length===3)&&!(mode==='--generate'&&process.argv[3]==='--record'&&process.argv.length===5))throw new Error(usage)
  const before=snapshot(),beforeDigest=digest(JSON.stringify(before))
  if(mode==='--audit-only')console.log(JSON.stringify(before,null,2))
  else {
    // The fixture tree receives only source and encoded bytes; the run record
    // goes to the caller's path so no record lands beside tracked fixtures.
    const recordPath=path.resolve(process.argv[4])
    if(!path.relative(outputRoot,recordPath).startsWith('..'))throw new Error('The run record must lie outside the fixture tree')
    if(fs.existsSync(recordPath))throw new Error('Refusing to overwrite the run record')
    for(const name of Object.keys(sources))for(const seed of before.seeds)for(const filename of ['source.js',`encoded-${seed}.js`])if(fs.existsSync(path.join(outputRoot,name,filename)))throw new Error(`Refusing to overwrite ${name}/${filename}`)
    const startedAt=new Date().toISOString(),cells=[]
    try {
      for(const [name,source] of Object.entries(sources)) {
        const directory=path.join(outputRoot,name)
        fs.mkdirSync(directory,{recursive:true})
        fs.writeFileSync(path.join(directory,'source.js'),source,{flag:'wx'})
        for(const seed of before.seeds) {
          const cellStart=new Date().toISOString()
          const worker=await new Promise((resolve,reject)=>{
            const argv=[fileURLToPath(import.meta.url),'--worker',name,String(seed)]
            const child=spawn(process.execPath,argv,{cwd:decoderRoot,detached:true,stdio:['ignore','pipe','pipe']})
            let stdout='',stderr='',timedOut=false
            child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
            child.stdout.on('data',(data)=>stdout+=data);child.stderr.on('data',(data)=>stderr+=data)
            const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL')}catch{}},65000)
            child.once('error',(error)=>{clearTimeout(timer);reject(error)})
            child.once('close',(exitCode,signal)=>{clearTimeout(timer);const processRecord={executable:'node',argv:argv.map((value)=>path.isAbsolute(value)?path.relative(decoderRoot,value):value),cwd:'.',timeoutMs:65000,exitCode,signal,timedOut,stdoutSha256:digest(stdout),stderr};if(exitCode!==0||timedOut)reject(Object.assign(new Error('Generation cell process failed'),{processRecord}));else {try{resolve({result:JSON.parse(stdout),processRecord})}catch(error){reject(Object.assign(new Error(`Invalid worker stdout: ${error.message}`),{processRecord}))}}})
          })
          const {code,draws,processRecords}=worker.result
          if(processRecords.length!==1||processRecords[0].exitCode!==0)throw new Error('Current worker has no unique successful Closure process')
          const record={case:name,seed,options:{...options},startedAt:cellStart,completedAt:new Date().toISOString(),rng:{algorithm:'Mulberry32',seed,draws},encodedBytes:Buffer.byteLength(code),sourceObservation:null,encodedObservation:null,decodedObservation:null,publicAdmission:null,workerProcess:worker.processRecord,closureProcess:processRecords[0],generationManifest:'../generation-manifest.json'}
          fs.writeFileSync(path.join(directory,`encoded-${seed}.js`),code,{flag:'wx'})
          cells.push(record)
        }
      }
      const after=snapshot()
      if(beforeDigest!==digest(JSON.stringify(after)))throw new Error('Source/tool/dependency bytes changed during generation')
      fs.writeFileSync(recordPath,`${JSON.stringify({...before,startedAt,completedAt:new Date().toISOString(),cells,inputsUnchanged:true},null,2)}\n`,{flag:'wx'})
      console.log(JSON.stringify({outputRoot:before.outputRoot,record:recordPath,cells:cells.map(({case:name,seed,encodedBytes})=>({case:name,seed,encodedBytes}))}))
    } catch(error) {
      fs.writeFileSync(recordPath,`${JSON.stringify({...before,startedAt,failedAt:new Date().toISOString(),cells,error:error.message,processRecord:error.processRecord||null},null,2)}\n`,{flag:'wx'})
      throw error
    } finally {
      if(digest(JSON.stringify(before.checkout))!==digest(JSON.stringify(checkoutIdentity())))throw new Error('Encoder checkout changed, including on failure')
    }
  }
}
