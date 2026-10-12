import { parse } from '@babel/parser'
import {
  ContainerDecline,
  PARSER_OPTIONS,
  EXPECTED_OPCODES,
  decline,
  deepFreeze,
  makeContext,
  numberValue,
  propertyName,
  precedes,
} from './container-role-helpers.js'
import { diagnoseMinifiedClassBoot } from './observe-minified-class-boot.js'
import {
  HANDLER_CLAUSES,
  DEFAULT_CLAUSE,
  DEBUGGER_WITHOUT_STATEMENT,
} from './minified-class-handler-clauses.js'
import {
  ownedFunctions,
  OWNED_CLAUSES,
} from './minified-class-owned-functions.js'
import {
  clauseLiveness,
  compatibleRoleBindings,
} from './minified-class-binding-liveness.js'
import {
  semanticClause,
  semanticShape,
  tryClause,
} from './minified-class-semantic-clauses.js'

function requireGraph(condition, phase, message) {
  if (!condition) decline(`minified-class-${phase}`, message)
}
function unique(items, phase, message) {
  requireGraph(items.length === 1, phase, message)
  return items[0]
}
function selectedEntry(context, graph, call) {
  if (call.callee.type === 'Identifier')
    return unique(
      graph.functions.filter(
        (entry) => entry.binding === context.bindingFor(call.callee),
      ),
      'functions',
      'Selected reader helper is not owned',
    )
  return unique(
    graph.functions.filter(
      (entry) => entry.method?.name === propertyName(call.callee.property),
    ),
    'functions',
    'Selected reader method is not owned',
  )
}
function readerCall(context, graph, role, call, vm) {
  const entry = selectedEntry(context, graph, call)
  const receiver = entry.method
    ? 'this'
    : context.bindingFor(
        entry.fn.params[
          call.arguments.findIndex((argument) =>
            vm === 'this'
              ? argument.type === 'ThisExpression'
              : context.sameRef(argument, vm),
          )
        ],
      )
  // Q2 proves the complete reader operations. Their ignored dummy writes still
  // belong to this graph's receiver/ownership closure, including helper reuse.
  const readerEffects = graph.stripped(entry)
  requireGraph(
    role !== 'constant' ||
      graph.boot.loadConstant.constant.incidentalWrites.every((field) =>
        readerEffects.removed.has(field),
      ),
    'ownership',
    'Reader dummy writes have unproved field interactions',
  )
  const record = graph.register(
    role,
    { ...entry, retained: [] },
    new Map([['vm', receiver]]),
    ['vm'],
  )
  const argumentsFor = record.argumentsFor
  const incoming = clauseLiveness(readerEffects.body, (node) =>
    context.bindingFor(node),
  )
  record.argumentsFor = (actual) => {
    if (
      entry.method &&
      actual?.arguments?.some(
        (argument, index) =>
          incoming.has(context.bindingFor(entry.fn.params[index])) &&
          !undefinedValue(argument, context),
      )
    )
      return null
    return argumentsFor(actual)
  }
  return record
}
function undefinedValue(node, context) {
  return (
    (node?.type === 'UnaryExpression' &&
      node.operator === 'void' &&
      numberValue(node.argument) === 0) ||
    (node?.type === 'Identifier' &&
      node.name === 'undefined' &&
      !context.bindingFor(node))
  )
}
function effectPrecedes(left, right) {
  if (precedes(left, right)) return true
  const ancestors = new Map()
  for (let path = left; path?.parentPath; path = path.parentPath)
    ancestors.set(path.parentPath, path)
  for (let path = right; path?.parentPath; path = path.parentPath) {
    const sibling = ancestors.get(path.parentPath)
    if (!sibling) continue
    return (
      ((path.parentPath.isIfStatement() ||
        path.parentPath.isConditionalExpression()) &&
        sibling.key === 'test' &&
        ['consequent', 'alternate'].includes(path.key)) ||
      (path.parentPath.isLogicalExpression() &&
        sibling.key === 'left' &&
        path.key === 'right')
    )
  }
  return false
}
function verifyOwnership(context, graph, boot, roles, dispatchFunction) {
  requireGraph(
    !context
      .nodes(context.program)
      .some(({ node }) => node.type === 'Directive'),
    'ownership',
    'Runtime directives are outside the closed source form',
  )
  const records = [...graph.records.values()]
  const run = graph.calls.get('run'),
    VM = graph.calls.get('VM'),
    Closure = graph.calls.get('Closure'),
    Upvalue = graph.calls.get('Upvalue')
  const root = unique(
    context.program.body.filter(
      (statement) =>
        statement.type === 'ExpressionStatement' &&
        run.argumentsFor(statement.expression),
    ),
    'ownership',
    'Root invocation is not unique',
  )
  const arguments_ = run.argumentsFor(root.expression),
    vmArgs = VM.argumentsFor(arguments_[0]),
    closureArgs = Closure.argumentsFor(arguments_[1])
  requireGraph(
    vmArgs && closureArgs,
    'ownership',
    'Root constructor/run connection changed',
  )
  requireGraph(
    undefinedValue(arguments_[2], context) &&
      arguments_[3]?.type === 'NullLiteral',
    'ownership',
    'Root receiver/arguments changed',
  )
  const descriptor = closureArgs[0]
  requireGraph(
    descriptor?.type === 'ObjectExpression' &&
      descriptor.properties.length === 3 &&
      descriptor.properties.every(
        (property) =>
          property.type === 'ObjectProperty' &&
          !property.computed &&
          numberValue(property.value) ===
            (propertyName(property.key) === graph.roles.get('countField')
              ? boot.root.regCount
              : 0),
      ) &&
      new Set(
        descriptor.properties.map((property) => propertyName(property.key)),
      ).size === 3 &&
      ['paramField', 'countField', 'startField'].every((name) =>
        descriptor.properties.some(
          (property) => propertyName(property.key) === graph.roles.get(name),
        ),
      ),
    'ownership',
    'Root closure descriptor changed',
  )
  const global = context.bindingFor(vmArgs[2]),
    globalStatement = global?.path.parentPath.node
  requireGraph(
    global?.constant &&
      global.path.node.init?.type === 'Identifier' &&
      global.path.node.init.name === 'globalThis' &&
      !context.bindingFor(global.path.node.init),
    'ownership',
    'Global root is not stable globalThis',
  )
  const closureMap = roles.get('closureMap'),
    mapStatement = closureMap?.path.parentPath.node
  requireGraph(
    closureMap?.constant &&
      closureMap.path.node.init?.type === 'NewExpression' &&
      closureMap.path.node.init.callee.name === 'WeakMap' &&
      !context.bindingFor(closureMap.path.node.init.callee) &&
      closureMap.path.node.init.arguments.length === 0,
    'ownership',
    'Closure map is not stable owned WeakMap',
  )
  const fieldNames = new Map()
  for (const [name, value] of graph.roles) {
    if (!name.endsWith('Field')) continue
    const logical = name === 'uvRegsField' ? 'regsField' : name
    requireGraph(
      !fieldNames.has(value) || fieldNames.get(value) === logical,
      'ownership',
      'Distinct semantic fields overlap',
    )
    fieldNames.set(value, logical)
  }
  requireGraph(
    graph.roles.get('uvRegsField') === graph.roles.get('regsField'),
    'ownership',
    'Shared VM/upvalue register field changed',
  )
  // Closure objects own this fixed member independently of class-renamed
  // descriptor/upvalue fields. Native shells share its value, not its namespace.
  const fixedMembers = new Map([['Closure', new Set(['prototype'])]])
  const instanceFields = new Map([
    [
      'VM',
      [
        'wordsField',
        'poolField',
        'globalsField',
        'openField',
        'regsField',
        'topField',
        'frameField',
      ],
    ],
    ['Closure', ['descriptorField', 'upvaluesField']],
    ['Upvalue', ['uvRegsField', 'absField', 'closedField', 'valueField']],
  ])
  for (const [owner, names] of instanceFields) {
    requireGraph(
      names.every(
        (name) => !fixedMembers.get(owner)?.has(graph.roles.get(name)),
      ),
      'ownership',
      'Renamed field overlaps fixed semantic member',
    )
  }
  const methodKeys = new Set()
  for (const record of records) {
    const method = record.entry.method
    if (!method) continue
    const ownerRole = method.owner === VM.entry.binding ? 'VM' : 'Upvalue'
    const key = `${ownerRole}:${method.name}`
    requireGraph(
      !methodKeys.has(key) &&
        !fixedMembers.get(ownerRole)?.has(method.name) &&
        !fieldNames.has(method.name) &&
        !['__proto__', 'constructor'].includes(method.name),
      'ownership',
      'Owned method is overwritten or overlaps state',
    )
    methodKeys.add(key)
  }
  requireGraph(
    !fieldNames.has('__proto__'),
    'ownership',
    'Semantic field invokes prototype mutation',
  )
  const globals = semanticClause(
    'typeof window!=="undefined"&&($global.window=window,$global.document=typeof document!=="undefined"?document:void 0);typeof module!=="undefined"&&($global.module=module,$global.exports=typeof exports!=="undefined"?exports:void 0);',
  )
  const remaining = []
  for (const statement of context.program.body) {
    if (statement === root) continue
    if (statement === globalStatement || statement === mapStatement) {
      requireGraph(
        statement.type === 'VariableDeclaration' &&
          statement.kind === 'var' &&
          statement.declarations.every(
            (declaration) =>
              declaration === global.path.node ||
              declaration === closureMap.path.node,
          ),
        'ownership',
        'Global/map declaration contains unproved effects',
      )
      continue
    }
    if (statement.type === 'FunctionDeclaration') {
      const owned = records.find((record) => record.entry.fn === statement)
      requireGraph(
        owned && owned.entry.binding.constant,
        'ownership',
        'Unowned or overwritten function declaration',
      )
      requireGraph(
        !statement.async && !statement.generator,
        'ownership',
        'Owned callable is async or generator',
      )
      continue
    }
    if (
      statement.type === 'ExpressionStatement' &&
      statement.expression?.type === 'AssignmentExpression'
    ) {
      const owned = records.find(
        (record) => record.entry.method?.assignment === statement.expression,
      )
      requireGraph(
        owned &&
          precedes(context.paths.get(statement), context.paths.get(root)),
        'ownership',
        'Unowned or late prototype definition',
      )
      const expectedOwner = [
        'readUpvalue',
        'writeUpvalue',
        'closeUpvalue',
      ].includes([...graph.records].find(([, record]) => record === owned)?.[0])
        ? Upvalue.entry.binding
        : VM.entry.binding
      requireGraph(
        owned.entry.method.owner === expectedOwner,
        'ownership',
        'Method is attached to a different constructor',
      )
      requireGraph(
        !owned.entry.fn.async && !owned.entry.fn.generator,
        'ownership',
        'Owned callable is async or generator',
      )
      continue
    }
    remaining.push(statement)
  }
  requireGraph(
    tryClause(
      globals,
      remaining,
      context,
      new Map([['global', global]]),
      graph.calls,
    ),
    'ownership',
    'Global setup or top-level effects changed',
  )
  requireGraph(
    precedes(context.paths.get(globalStatement), context.paths.get(root)) &&
      precedes(context.paths.get(mapStatement), context.paths.get(root)),
    'ownership',
    'Global/map initialization is after root execution',
  )
  for (const effect of graph.effects) {
    const record = records.find(
      (record) => record.entry.fn === effect.functionNode,
    )
    requireGraph(
      record,
      'ownership',
      'Dummy write belongs to an unproved function',
    )
    const receiver = effect.receiver
    const expected = record.local.get('vm') ?? record.local.get('uv')
    const receiverBinding = context.bindingFor(receiver)
    if (receiver.type === 'ThisExpression')
      requireGraph(
        context.paths.get(receiver)?.getFunctionParent()?.node ===
          record.entry.fn,
        'ownership',
        'Dummy write receiver belongs to a nested function',
      )
    if (receiverBinding === record.local.get('vm')) {
      const earlier = context
        .nodes(record.entry.fn)
        .filter(
          ({ node, path }) =>
            ((node.type === 'AssignmentExpression' &&
              context.bindingFor(node.left) === receiverBinding) ||
              (node.type === 'VariableDeclarator' &&
                context.bindingFor(node.id) === receiverBinding)) &&
            effectPrecedes(path, context.paths.get(receiver)),
        )
      requireGraph(
        earlier.length === 0,
        'ownership',
        'Dummy write VM receiver has been repurposed',
      )
    }
    if (
      receiverBinding === record.local.get('uv') &&
      !record.entry.fn.params.some(
        (p) => context.bindingFor(p) === receiverBinding,
      )
    ) {
      const definitions = context
        .nodes(record.entry.fn)
        .filter(
          ({ node, path }) =>
            ((node.type === 'AssignmentExpression' &&
              context.bindingFor(node.left) === receiverBinding) ||
              (node.type === 'VariableDeclarator' &&
                context.bindingFor(node.id) === receiverBinding)) &&
            effectPrecedes(path, context.paths.get(receiver)),
        )
      const lastNode = definitions.at(-1)?.node
      const last = lastNode?.right ?? lastNode?.init
      requireGraph(
        last?.type === 'MemberExpression' &&
          last.computed &&
          context.bindingFor(last.object) === record.local.get('table') &&
          context.bindingFor(last.property) === record.local.get('counter'),
        'ownership',
        'Dummy write upvalue receiver is not the captured table entry',
      )
    }
    requireGraph(
      (receiver.type === 'ThisExpression' && record.entry.method) ||
        (receiver.type === 'ThisExpression' &&
          ['VM', 'Closure', 'Upvalue'].some(
            (role) => graph.records.get(role).entry === record.entry,
          )) ||
        context.bindingFor(receiver) === expected ||
        context.bindingFor(receiver) === record.local.get('uv'),
      'ownership',
      'Dummy write has an unknown receiver',
    )
    const effectRole = [...graph.records].find(
      ([, candidate]) => candidate === record,
    )?.[0]
    requireGraph(
      !fixedMembers.get(effectRole)?.has(effect.field),
      'ownership',
      'Dummy write overlaps fixed semantic member',
    )
    requireGraph(
      !fieldNames.has(effect.field),
      'ownership',
      'Dummy field overlaps runtime state',
    )
  }
  requireGraph(
    records.some((record) => record.entry.fn === dispatchFunction),
    'ownership',
    'Dispatch function is unowned',
  )
}
function connections(context, graph) {
  const result = []
  for (const { node, path } of context.nodes(context.program)) {
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression')
      continue
    for (const [role, record] of graph.records) {
      if (!record.argumentsFor(node)) continue
      const casePath = path.findParent((parent) => parent.isSwitchCase())
      const owner = path.findParent((parent) =>
        [...graph.records.values()].some(
          (candidate) => candidate.entry.fn === parent.node,
        ),
      )
      const from = casePath
        ? `handler:${numberValue(casePath.node.test)}`
        : owner
          ? [...graph.records].find(
              ([, candidate]) => candidate.entry.fn === owner.node,
            )[0]
          : 'root'
      result.push({
        from,
        to: role,
        kind: record.entry.method ? 'method' : 'helper',
        canonicalArguments: record.params,
      })
    }
  }
  return result
}
function observe(input, { deferEntry = false } = {}) {
  const ast = typeof input === 'string' ? parse(input, PARSER_OPTIONS) : input
  const bootstrapAst = structuredClone(ast)
  const bootstrapContext = makeContext(bootstrapAst)
  const bootstrapSwitches = bootstrapContext
    .nodes(bootstrapContext.program)
    .filter(({ node }) => node.type === 'SwitchStatement')
  if (bootstrapSwitches.length === 1) {
    const cases = bootstrapSwitches[0].node.cases
    const order = [
      ...Object.values(EXPECTED_OPCODES).slice(0, -4),
      EXPECTED_OPCODES.FINALLY_SETUP,
      EXPECTED_OPCODES.PATCH,
      EXPECTED_OPCODES.JUMP_REG,
      EXPECTED_OPCODES.DEBUGGER,
      null,
    ]
    const labels = cases.map((item) =>
      item.test === null ? null : numberValue(item.test),
    )
    if (
      cases.length === order.length &&
      new Set(labels).size === order.length &&
      order.every((value) => labels.includes(value))
    )
      bootstrapSwitches[0].node.cases = order.map(
        (value) => cases[labels.indexOf(value)],
      )
  }
  const bounded = diagnoseMinifiedClassBoot(bootstrapAst, { deferEntry })
  if (!bounded.ok) {
    const error = new ContainerDecline(
      bounded.diagnostic.code,
      bounded.diagnostic.message,
    )
    error.bootPreflight = true
    throw error
  }
  const boot = bounded.result,
    context = makeContext(ast)
  const dispatch = unique(
    context
      .nodes(context.program)
      .filter(({ node }) => node.type === 'SwitchStatement'),
    'dispatch',
    'Complete numeric dispatch switch is not unique',
  ).node
  const fn = context.paths.get(dispatch).getFunctionParent().node
  const graph = ownedFunctions(context, boot)
  const vm =
    fn.type === 'FunctionExpression' ? 'this' : context.bindingFor(fn.params[0])
  const roles = new Map([
    ['vm', vm],
    ['wordsField', boot.fields.words],
    ['poolField', boot.fields.pool],
    ['globalsField', boot.fields.globals],
    ['regsField', boot.frame.regs],
    ['topField', boot.frame.top],
    ['frameField', boot.frame.frame],
  ])
  for (const [name, value] of roles)
    if (name.endsWith('Field')) graph.roles.set(name, value)
  const selected = dispatch.cases.find((item) => numberValue(item.test) === 0)
  const selectedBody = semanticShape(selected.consequent)
  readerCall(context, graph, 'operand', selectedBody[0].right, vm)
  readerCall(context, graph, 'constant', selectedBody[1].right, vm)

  // Constructor identities are established from the unique retained boot and
  // their complete parameter/field bodies, before any helper invocation is used.
  graph.identify(
    'VM',
    [
      `this.$wordsField=$words;this.$poolField=$pool;this.$globalsField=$globals;this.$openField=null;this.$regsField=[];this.$topField=1;this.$frameField=0;`,
    ],
    roles,
    undefined,
    true,
  )
  graph.identify(
    'Closure',
    [
      'this.$descriptorField=$descriptor;this.$upvaluesField=[];this.prototype={};',
    ],
    roles,
    undefined,
    true,
  )
  graph.identify(
    'Upvalue',
    [
      'this.$uvRegsField=$uvRegs;this.$absField=$abs;this.$closedField=!1;this.$valueField=void 0;',
    ],
    roles,
    undefined,
    true,
  )
  graph.identify('bytes', OWNED_CLAUSES.bytes, roles, ['value'])
  graph.identify(
    'closeUpvalue',
    OWNED_CLAUSES.closeUpvalue,
    roles,
    undefined,
    false,
    true,
  )
  for (const role of [
    'pushFrame',
    'capture',
    'closeFrame',
    'readUpvalue',
    'writeUpvalue',
  ])
    graph.identify(role, OWNED_CLAUSES[role], roles)

  const tryNode = context.paths
    .get(dispatch)
    .findParent((path) => path.isTryStatement()).node
  const prefix = semanticShape(
    tryNode.block.body.slice(0, tryNode.block.body.indexOf(dispatch)),
  )
  const basePattern = semanticClause('$base=$regs[$fp+7];')
  const dispatchRoles = tryClause(
    basePattern,
    prefix,
    context,
    new Map([...roles, ...graph.roles]),
    graph.calls,
  )
  requireGraph(
    dispatchRoles,
    'dispatch',
    'Dispatch register base is disconnected',
  )
  dispatchRoles.set('opcode', context.bindingFor(dispatch.discriminant))
  const frameCalls = context
    .nodes(fn)
    .filter(
      ({ node, path }) =>
        node.type === 'CallExpression' &&
        path.getFunctionParent()?.node === fn &&
        precedes(path, context.paths.get(dispatch)) &&
        graph.calls.get('pushFrame').argumentsFor(node),
    )
    .map(({ node }) => node)
  const frameCall = unique(
    frameCalls,
    'entry',
    'Initial frame call is not unique',
  )
  const frameArguments = graph.calls.get('pushFrame').argumentsFor(frameCall)
  const entry = unique(
    graph.functions.filter((e) => e.fn === fn),
    'entry',
    'Dispatch body is not owned',
  )
  graph.register(
    'run',
    { ...entry, retained: [] },
    new Map([
      ['vm', vm],
      ['closure', context.bindingFor(frameArguments[1])],
      ['args', context.bindingFor(frameArguments[2])],
      ['thisValue', context.bindingFor(frameArguments[3])],
    ]),
    ['vm', 'closure', 'thisValue', 'args'],
  )
  const observations = []
  for (const item of dispatch.cases) {
    const opcode = numberValue(item.test)
    const pattern =
      item.test === null
        ? DEFAULT_CLAUSE
        : opcode === EXPECTED_OPCODES.DEBUGGER &&
            !context
              .nodes(item)
              .some(({ node }) => node.type === 'DebuggerStatement')
          ? DEBUGGER_WITHOUT_STATEMENT
          : HANDLER_CLAUSES.get(opcode)
    requireGraph(pattern, 'handler', `Unknown numeric handler ${opcode}`)
    const result = tryClause(
      pattern,
      item.consequent,
      context,
      dispatchRoles,
      graph.calls,
    )
    requireGraph(
      result && compatibleRoleBindings(pattern, result),
      'handler',
      `${Object.entries(EXPECTED_OPCODES).find(([, value]) => value === opcode)?.[0] ?? 'DEFAULT'}: complete handler body or connection changed`,
    )
    for (const [name, value] of result)
      if (name.endsWith('Field')) {
        requireGraph(
          !graph.roles.has(name) || graph.roles.get(name) === value,
          'handler',
          `${opcode}: shared field identity changed`,
        )
        graph.roles.set(name, value)
        dispatchRoles.set(name, value)
      }
    if (result.has('closureMap')) {
      requireGraph(
        !dispatchRoles.has('closureMap') ||
          dispatchRoles.get('closureMap') === result.get('closureMap'),
        'handler',
        `${opcode}: closure map identity changed`,
      )
      dispatchRoles.set('closureMap', result.get('closureMap'))
    }
    observations.push({
      opcode,
      name:
        Object.entries(EXPECTED_OPCODES).find(
          ([, value]) => value === opcode,
        )?.[0] ?? 'DEFAULT',
      body: 'complete-source-clause',
    })
  }
  const envelopeSource = `$pushFrame($vm,$closure,$args,$thisValue,0);for(;;){$fp=$vm.$frameField;$regs=$vm.$regsField;$pc=$regs[$fp+0];if($pc>=$vm.$wordsField.length)break;$regs[$fp+0]=$pc+1;$pc=$vm.$wordsField[$pc];try{$base=$regs[$fp+7];switch($pc){}}catch($error){$handled=0;for($search=$vm.$frameField;$search;){$handlers=$regs[$search+5];if($handlers&&$handlers.length>0){$handled=$search;break;}$closeFrame($vm,$search);$vm.$topField=$search;$search=$regs[$search+1];$vm.$frameField=$search;}if(!$handled)throw $error;$record=$regs[$handled+5].pop();$handlerBase=$regs[$handled+7];$record.$exceptionRegField!==void 0?($regs[$handlerBase+$record.$exceptionRegField]=$error,$regs[$handled+0]=$record.$handlerPcField):($regs[$handlerBase+$record.$contRegField]=$record.$throwPadField,$regs[$handlerBase+$record.$payloadRegField]=$error,$regs[$handled+0]=$record.$finallyPcField);$vm.$topField=$handled+$regs[$handled+6];$vm.$frameField=$handled;}if(!$vm.$frameField)return $vm.$regsField[0];}`
  const runRoles = new Map([
    ...roles,
    ...graph.roles,
    ['closure', context.bindingFor(frameArguments[1])],
    ['args', context.bindingFor(frameArguments[2])],
    ['thisValue', context.bindingFor(frameArguments[3])],
  ])
  const actualEnvelope = graph.stripped(entry).body
  let closedEnvelope
  for (const distinct of [false, true])
    for (const alias of [false, true]) {
      let source = envelopeSource
      if (distinct)
        source = source
          .replace('$pc=$vm.$wordsField[$pc];', '$opcode=$vm.$wordsField[$pc];')
          .replace('switch($pc)', 'switch($opcode)')
      if (alias)
        source = source
          .replace(
            '$pc=$regs[$fp+0];',
            '$wordAlias=$vm.$wordsField;$pc=$regs[$fp+0];',
          )
          .replace('$pc>=$vm.$wordsField.length', '$pc>=$wordAlias.length')
      const candidate = semanticClause(source),
        swapped = structuredClone(candidate)
      const loop = swapped.find((node) => node.type === 'ForStatement')
      ;[loop.body[0], loop.body[1]] = [loop.body[1], loop.body[0]]
      for (const variant of [candidate, swapped]) {
        const proof = tryClause(
          variant,
          actualEnvelope,
          context,
          runRoles,
          graph.calls,
        )
        if (proof && compatibleRoleBindings(variant, proof))
          closedEnvelope = proof
      }
    }
  requireGraph(
    closedEnvelope,
    'entry',
    'Complete entry/dispatch/exception/completion effects changed',
  )
  verifyOwnership(context, graph, boot, dispatchRoles, fn)
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-minified-class-runtime.v1',
    boot,
    handlers: observations,
    completeHandlers: true,
    proof: {
      kind: 'source-AST',
      scope: 'complete-selected-runtime',
      publicAdmission: false,
      nativeEquivalence: false,
    },
    functions: [...graph.records].map(([role, record]) => ({
      role,
      name: record.entry.method?.name ?? record.entry.binding.identifier.name,
      kind: record.entry.method ? 'method' : 'helper',
      parameterPositions: record.indexes,
    })),
    connections: connections(context, graph),
    fields: Object.fromEntries(graph.roles),
    effects: {
      entry: 'complete',
      exception: 'complete',
      completion: 'complete',
      dummyWrites: graph.effects.map((effect) => ({
        field: effect.field,
        role: [...graph.records].find(
          ([, record]) => record.entry.fn === effect.functionNode,
        )?.[0],
      })),
    },
  })
}
export function diagnoseMinifiedClassRuntime(input) {
  try {
    let result
    try {
      result = observe(input)
    } catch (error) {
      if (!(error instanceof ContainerDecline) || !error.bootPreflight)
        throw error
      // Deferred boot establishes candidates for the complete graph only. If
      // that graph fails, keep the bounded observer's original family boundary
      // so an ordinary minified runtime can reach its own observer.
      try {
        result = observe(input, { deferEntry: true })
      } catch (deferredError) {
        if (!(deferredError instanceof ContainerDecline)) throw deferredError
        throw error
      }
    }
    return deepFreeze({ ok: true, result, diagnostic: null })
  } catch (error) {
    if (error instanceof SyntaxError)
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: 'malformed-input', message: error.message },
      })
    if (!(error instanceof ContainerDecline)) throw error
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: { code: error.code, message: error.message },
    })
  }
}
