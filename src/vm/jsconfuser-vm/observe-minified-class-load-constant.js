import { parse } from '@babel/parser'
import {
  decline,
  EXPECTED_OPCODES,
  numberValue,
  propertyName,
  precedes,
} from './container-role-helpers.js'
import {
  inert,
  ownedFunctions,
  OWNED_CLAUSES,
} from './minified-class-owned-functions.js'
import {
  clauseLiveness,
  compatibleRoleBindings,
} from './minified-class-binding-liveness.js'

function requireRole(condition, message) {
  if (!condition) decline('incomplete-role', message)
}

// Normalize only declaration/assignment and sequence/block spellings. Identifiers
// retain their original nodes so the matcher compares resolved lexical bindings.
function shape(node, statement = false) {
  if (!node) return null
  if (Array.isArray(node))
    return statement
      ? node.flatMap((item) => shape(item, true))
      : node.map((item) => shape(item))
  if (node.type === 'BlockStatement') return shape(node.body, true)
  if (node.type === 'ExpressionStatement') return shape(node.expression, true)
  if (node.type === 'SequenceExpression' && statement)
    return node.expressions.flatMap((item) => shape(item, true))
  if (node.type === 'VariableDeclaration') {
    if (node.kind !== 'var') return { type: 'UnsupportedDeclaration' }
    return node.declarations.map((item) => ({
      type: 'AssignmentExpression',
      operator: '=',
      left: item.id,
      right: shape(item.init),
    }))
  }
  if (node.type === 'Identifier' || node.type === 'ThisExpression') return node
  if (node.type === 'ForStatement') {
    const init = shape(node.init, true)
    return {
      type: node.type,
      init: Array.isArray(init) && init.length === 1 ? init[0] : init,
      test: shape(node.test),
      update: shape(node.update),
      body: Array.isArray(shape(node.body, true))
        ? shape(node.body, true)
        : [shape(node.body, true)],
    }
  }
  const keys = {
    SequenceExpression: ['expressions'],
    AssignmentExpression: ['operator', 'left', 'right'],
    BinaryExpression: ['operator', 'left', 'right'],
    LogicalExpression: ['operator', 'left', 'right'],
    UnaryExpression: ['operator', 'prefix', 'argument'],
    UpdateExpression: ['operator', 'prefix', 'argument'],
    MemberExpression: ['computed', 'object', 'property'],
    CallExpression: ['callee', 'arguments'],
    ReturnStatement: ['argument'],
    BreakStatement: ['label'],
    IfStatement: ['test', 'consequent', 'alternate'],
    ConditionalExpression: ['test', 'consequent', 'alternate'],
    ForStatement: ['init', 'test', 'update', 'body'],
    FunctionExpression: ['params', 'body', 'async', 'generator'],
    NumericLiteral: ['value'],
    StringLiteral: ['value'],
    BooleanLiteral: ['value'],
    NullLiteral: [],
    ArrayExpression: ['elements'],
    ObjectExpression: ['properties'],
  }[node.type]
  if (!keys) return { type: `Unsupported:${node.type}` }
  return Object.fromEntries([
    ['type', node.type],
    ...keys.map((key) => [
      key,
      typeof node[key] === 'object'
        ? shape(
            node[key],
            (node.type === 'IfStatement' &&
              ['consequent', 'alternate'].includes(key)) ||
              (node.type === 'FunctionExpression' && key === 'body'),
          )
        : node[key],
    ]),
  ])
}

function match(
  pattern,
  actual,
  context,
  roles,
  property = false,
  calls = new Map(),
) {
  if (pattern?.type === 'Identifier') {
    if (pattern.name.startsWith('$')) {
      const key = pattern.name.slice(1)
      if (property) {
        const name = propertyName(actual)
        if (!name) return false
        if (!roles.has(key)) roles.set(key, name)
        return name === roles.get(key)
      }
      if (key === 'vm' && roles.get(key) === 'this')
        return actual?.type === 'ThisExpression'
      const binding = context.bindingFor(actual)
      if (!binding) return false
      if (!roles.has(key)) roles.set(key, binding)
      return roles.get(key) === binding
    }
    return (
      actual?.type === 'Identifier' &&
      actual.name === pattern.name &&
      (property || !context.bindingFor(actual))
    )
  }
  if (Array.isArray(pattern)) {
    return (
      Array.isArray(actual) &&
      pattern.length === actual.length &&
      pattern.every((item, index) =>
        match(item, actual[index], context, roles, false, calls),
      )
    )
  }
  if (pattern === null || typeof pattern !== 'object') return pattern === actual
  if (
    pattern.type === 'CallExpression' &&
    pattern.callee.type === 'Identifier' &&
    calls.has(pattern.callee.name.slice(1))
  ) {
    const arguments_ = calls.get(pattern.callee.name.slice(1))(actual)
    return (
      arguments_ !== null &&
      match(pattern.arguments, arguments_, context, roles, false, calls)
    )
  }
  return (
    actual?.type === pattern.type &&
    Object.entries(pattern).every(([key, value]) =>
      match(
        value,
        actual[key],
        context,
        roles,
        pattern.type === 'MemberExpression' &&
          key === 'property' &&
          !pattern.computed,
        calls,
      ),
    )
  )
}

function bodyPattern(source) {
  return shape(parse(`function role(){${source}}`).program.body[0].body)
}

const operandPattern = bodyPattern(
  'return $vm.$words[$vm.$regs[$vm.$frame+0]++];',
)
const bytesPattern = bodyPattern(`return typeof Buffer!=="undefined"?
  Buffer.from($value,"base64"):Uint8Array.from(atob($value),function($char){
    return $char.charCodeAt(0)
  });`)
const constantPatterns = [false, true].flatMap((method) =>
  [false, true].flatMap((separateState) =>
    [false, true].map((separateBytes) => ({
      method,
      separateState,
      separateBytes,
      pattern: bodyPattern(`
    $index=${method ? '$inputIndex??' : ''}$operand($vm);
    $key=${method ? '$inputKey??' : ''}$operand($vm);
    $value=$vm.$pool[$index];
    if(!$key)return $value;
    if(typeof $value==="number")return $value^$key;
    if(typeof $value!=="string")return $value;
    ${separateBytes ? '$buffer' : '$value'}=$bytes($value);$out="";
    ${separateState ? '$state=$key;' : ''}
    for(var $counter=0;$counter<${separateBytes ? '$buffer' : '$value'}.length/2;$counter++){
      ${separateState ? '$state' : '$key'}=${separateState ? '$state' : '$key'}+2654435769|0;
      $out+=String.fromCharCode((${separateBytes ? '$buffer' : '$value'}[$counter*2]|${separateBytes ? '$buffer' : '$value'}[$counter*2+1]<<8)^
        (${separateState ? '$state' : '$key'}^${separateState ? '$state' : '$key'}>>>13)&65535);
    }
    return $out;
  `),
    })),
  ),
)

function memberKey(node) {
  if (node?.type !== 'MemberExpression') return null
  return node.computed
    ? node.property.type === 'StringLiteral'
      ? node.property.value
      : null
    : propertyName(node.property)
}

const frameEffectPattern = bodyPattern(`
  for(var $descriptor=$closure.$descriptorField,$regs=$vm.$regsField,
      $fp=$vm.$topField,$size=8+$descriptor.$countField,$end=$fp+$size;
      $regs.length<$end;)$regs.push(void 0);
  for(var $counter=$fp;$counter<$end;$counter++)$regs[$counter]=void 0;
  $base=$fp+8;
  $regs[$fp+0]=$descriptor.$startField;
  $regs[$fp+1]=$vm.$frameField;
  $regs[$fp+2]=$retDst;
  $regs[$fp+3]=$thisValue;
  $regs[$fp+4]=$closure;
  $regs[$fp+6]=$size;
  $regs[$fp+7]=$base;
  $vm.$topField=$end;
  if($args){
    if($descriptor.$restField){
      $limit=$descriptor.$paramField-1;
      for($argCounter=0;$argCounter<$limit;$argCounter++)
        $regs[$base+$argCounter]=$argCounter<$args.length?$args[$argCounter]:void 0;
      $regs[$base+$limit]=$args.slice($limit);
    }else for($limit=0;$limit<$args.length&&$limit<$descriptor.$countField;$limit++)
      $regs[$base+$limit]=$args[$limit];
    $descriptor.$paramField<$descriptor.$countField&&
      ($regs[$base+$descriptor.$paramField]=$args);
  }
  $vm.$frameField=$fp;
`)

function closedEntryEffects(
  context,
  call,
  constructorBinding,
  selectedName,
  boot,
) {
  if (
    context.paths.get(call).getFunctionParent().node.type ===
    'FunctionExpression'
  )
    return closedMethodEntryEffects(context, call, constructorBinding, boot)
  const closed = (condition, message) => requireRole(condition, message)
  const constructor = constructorBinding.path.node
  const constructorFields = new Set(
    constructor.body.body.map((statement) =>
      memberKey(statement.expression?.left),
    ),
  )
  const ctorParams = new Set(
    constructor.params.map((param) => context.bindingFor(param)),
  )
  const scalar = (node) =>
    [
      'NumericLiteral',
      'StringLiteral',
      'BooleanLiteral',
      'NullLiteral',
    ].includes(node?.type) ||
    (node?.type === 'ArrayExpression' && node.elements.length === 0) ||
    (node?.type === 'UnaryExpression' &&
      node.operator === 'void' &&
      numberValue(node.argument) === 0) ||
    (!!context.bindingFor(node) && ctorParams.has(context.bindingFor(node)))
  closed(
    constructor.body.body.every((statement) => {
      const expression = statement.expression
      return (
        statement.type === 'ExpressionStatement' &&
        expression.type === 'AssignmentExpression' &&
        expression.operator === '=' &&
        expression.left.type === 'MemberExpression' &&
        !expression.left.computed &&
        expression.left.object.type === 'ThisExpression' &&
        scalar(expression.right)
      )
    }),
    'LOAD_CONST constructor effects are outside the closed entry shape',
  )
  const dispatchPath = context.paths.get(call).getFunctionParent()
  const switchPath = context.paths
    .get(call)
    .findParent((path) => path.isSwitchStatement())
  const tryPath = switchPath.parentPath.parentPath
  const loopPath = tryPath.parentPath.parentPath
  closed(
    tryPath.isTryStatement() &&
      tryPath.node.block === switchPath.parentPath.node &&
      loopPath.isForStatement() &&
      loopPath.node.body === tryPath.parentPath.node &&
      loopPath.parentPath.node === dispatchPath.node.body &&
      !loopPath.node.test &&
      !loopPath.node.update,
    'LOAD_CONST dispatch effects are outside the closed entry shape',
  )
  const beforeLoop = dispatchPath.node.body.body.slice(
    0,
    dispatchPath.node.body.body.indexOf(loopPath.node),
  )
  closed(
    beforeLoop.every(
      (statement) =>
        statement.type === 'VariableDeclaration' &&
        statement.kind === 'var' &&
        statement.declarations.every(
          (item) => item.id.type === 'Identifier' && !item.init,
        ),
    ),
    'LOAD_CONST dispatch effects are outside the closed entry shape',
  )
  const frameCall = loopPath.node.init
  const helper =
    frameCall?.type === 'CallExpression' && context.bindingFor(frameCall.callee)
  closed(
    helper?.path.node.type === 'FunctionDeclaration' &&
      context.paths.get(helper.path.node).parentPath.isProgram() &&
      helper.constantViolations.length === 0 &&
      !helper.path.node.async &&
      !helper.path.node.generator &&
      frameCall.arguments.length === helper.path.node.params.length &&
      context.sameRef(
        frameCall.arguments[0],
        context.bindingFor(dispatchPath.node.params[0]),
      ),
    'LOAD_CONST frame helper is not stable and top-level in the closed entry shape',
  )
  const vm = context.bindingFor(dispatchPath.node.params[0])
  const dispatchParams = new Set(
    dispatchPath.node.params.map((param) => context.bindingFor(param)),
  )
  const voidZero = (node) =>
    node?.type === 'UnaryExpression' &&
    node.operator === 'void' &&
    numberValue(node.argument) === 0
  closed(
    frameCall.arguments.every(
      (argument, index) =>
        index === 0 ||
        (argument.type === 'Identifier' &&
          context.bindingFor(argument) !== vm &&
          dispatchParams.has(context.bindingFor(argument))) ||
        [
          'NumericLiteral',
          'StringLiteral',
          'BooleanLiteral',
          'NullLiteral',
        ].includes(argument.type) ||
        voidZero(argument),
    ),
    'LOAD_CONST frame call effects are outside the closed entry shape',
  )
  const prefix = loopPath.node.body.body.slice(
    0,
    loopPath.node.body.body.indexOf(tryPath.node),
  )
  const basePrefix = tryPath.node.block.body.slice(
    0,
    tryPath.node.block.body.indexOf(switchPath.node),
  )
  const patterns = [false, true].map((swapped) =>
    shape(
      parse(`function role(){for(;;){
    ${swapped ? '$regs=$vm.$regsField;$fp=$vm.$frameField;' : '$fp=$vm.$frameField;$regs=$vm.$regsField;'}
    $pc=$regs[$fp+0];if($pc>=$vm.$wordsField.length)break;
    $regs[$fp+0]=$pc+1;$pc=$vm.$wordsField[$pc];
    $base=$regs[$fp+7];
  }}`).program.body[0].body.body[0].body,
    ),
  )
  closed(
    patterns.some((pattern) =>
      match(
        pattern,
        shape([...prefix, ...basePrefix], true),
        context,
        new Map([['vm', vm]]),
      ),
    ),
    'LOAD_CONST dispatch effects are outside the closed entry shape',
  )
  const fn = helper.path.node
  const frameVM = context.bindingFor(fn.params[0])
  const dummyWrites = []
  const body = fn.body.body.filter((statement) => {
    const expression = statement.expression
    const left = expression?.left
    if (
      expression?.type !== 'AssignmentExpression' ||
      expression.operator !== '=' ||
      left?.type !== 'MemberExpression' ||
      left.computed ||
      !context.sameRef(left.object, frameVM)
    )
      return true
    const index = fn.params.findIndex(
      (param) =>
        context.bindingFor(param) === context.bindingFor(expression.right),
    )
    const argument = frameCall.arguments[index]
    if (
      index <= 0 ||
      memberKey(left) === selectedName ||
      constructorFields.has(memberKey(left)) ||
      argument?.type !== 'UnaryExpression' ||
      argument.operator !== 'void' ||
      numberValue(argument.argument) !== 0
    )
      return true
    dummyWrites.push({
      field: memberKey(left),
      parameterIndex: index,
      argument: 'void 0',
    })
    return false
  })
  const roles = new Map([['vm', frameVM]])
  closed(
    match(frameEffectPattern, shape(body, true), context, roles),
    'LOAD_CONST frame helper effects are outside the closed entry shape',
  )
  closed(
    ['closure', 'retDst', 'thisValue', 'args'].every((key) =>
      fn.params.some((param) => context.bindingFor(param) === roles.get(key)),
    ) &&
      new Set(
        ['vm', 'closure', 'retDst', 'thisValue', 'args'].map((key) =>
          roles.get(key),
        ),
      ).size === 5 &&
      ['descriptor', 'regs', 'fp', 'size', 'end'].every(
        (key) => roles.get(key)?.scope.path.node === fn,
      ) &&
      new Set(
        ['descriptor', 'regs', 'fp', 'size', 'end'].map((key) =>
          roles.get(key),
        ),
      ).size === 5 &&
      ['descriptor', 'regs', 'fp', 'size', 'end', 'base', 'counter'].every(
        (key) =>
          !['vm', 'closure', 'retDst', 'thisValue', 'args'].some(
            (param) => roles.get(key) === roles.get(param),
          ),
      ) &&
      ['base', 'counter', 'limit', 'argCounter'].every(
        (key) =>
          !['vm', 'descriptor', 'regs', 'fp', 'size', 'end'].some(
            (held) => roles.get(key) === roles.get(held),
          ),
      ) &&
      roles.get('limit') !== roles.get('args') &&
      roles.get('argCounter') !== roles.get('args') &&
      dummyWrites.every(
        ({ field }) =>
          !['regsField', 'frameField', 'topField'].some(
            (key) => roles.get(key) === field,
          ),
      ),
    'LOAD_CONST frame helper effect bindings are incompatible',
  )
  const argsIndex = fn.params.findIndex(
    (param) => context.bindingFor(param) === roles.get('args'),
  )
  const argsArgument = frameCall.arguments[argsIndex]
  const dispatchIndex = dispatchPath.node.params.findIndex(
    (param) => context.bindingFor(param) === context.bindingFor(argsArgument),
  )
  const rootArgs =
    dispatchIndex >= 0 ? boot.expression.arguments[dispatchIndex] : argsArgument
  closed(
    rootArgs?.type === 'NullLiteral' || !rootArgs || voidZero(rootArgs),
    'LOAD_CONST root frame arguments are outside the closed entry shape',
  )
  return {
    scope: 'selected-entry',
    frameDummyWrites: dummyWrites,
    laterHandlers: 'unproved',
  }
}

function closedMethodEntryEffects(context, call, constructorBinding, boot) {
  const dispatchPath = context.paths.get(call).getFunctionParent()
  const graph = ownedFunctions(context, null)
  const entry = graph.functions.find(({ fn }) => fn === dispatchPath.node)
  requireRole(
    entry?.method?.owner === constructorBinding &&
      precedes(
        context.paths.get(entry.method.assignment),
        context.paths.get(boot),
      ),
    'LOAD_CONST selected method dispatch is detached from VM prototype',
  )
  const constructor = constructorBinding.path.node
  const ctorParams = new Set(
    constructor.params.map((param) => context.bindingFor(param)),
  )
  const fields = new Set()
  requireRole(
    constructor.body.body.every((statement) => {
      const expression = statement.expression
      const left = expression?.left
      if (
        expression?.type !== 'AssignmentExpression' ||
        expression.operator !== '=' ||
        left?.type !== 'MemberExpression' ||
        left.computed ||
        left.object.type !== 'ThisExpression' ||
        !inert(expression.right, context, ctorParams) ||
        fields.has(memberKey(left))
      )
        return false
      fields.add(memberKey(left))
      return true
    }),
    'LOAD_CONST constructor effects are outside the closed entry shape',
  )
  const switchPath = context.paths
    .get(call)
    .findParent((path) => path.isSwitchStatement())
  const tryPath = switchPath.parentPath.parentPath
  const loopPath = tryPath.parentPath.parentPath
  requireRole(
    tryPath.isTryStatement() &&
      tryPath.node.block === switchPath.parentPath.node &&
      loopPath.isForStatement() &&
      loopPath.node.body === tryPath.parentPath.node &&
      loopPath.parentPath.node === dispatchPath.node.body &&
      !loopPath.node.test &&
      !loopPath.node.update,
    'LOAD_CONST dispatch effects are outside the closed entry shape',
  )
  const parameters = new Set(
    dispatchPath.node.params.map((param) => context.bindingFor(param)),
  )
  const beforeLoop = dispatchPath.node.body.body.slice(
    0,
    dispatchPath.node.body.body.indexOf(loopPath.node),
  )
  requireRole(
    beforeLoop.every((statement) => {
      if (statement.type === 'VariableDeclaration')
        return (
          statement.kind === 'var' &&
          statement.declarations.every(
            (item) => item.id.type === 'Identifier' && !item.init,
          )
        )
      const expression = statement.expression
      const left = expression?.left
      return (
        expression?.type === 'AssignmentExpression' &&
        expression.operator === '=' &&
        left?.type === 'MemberExpression' &&
        !left.computed &&
        left.object.type === 'ThisExpression' &&
        !fields.has(memberKey(left)) &&
        graph.writesOnly.has(memberKey(left)) &&
        inert(expression.right, context, parameters)
      )
    }),
    'LOAD_CONST dispatch effects are outside the closed entry shape',
  )
  const frameCall = loopPath.node.init
  let frame
  try {
    frame = graph.identify('pushFrame', OWNED_CLAUSES.pushFrame, new Map())
  } catch (error) {
    if (error.code !== 'minified-class-functions') throw error
    requireRole(
      false,
      'LOAD_CONST frame helper effects are outside the closed entry shape',
    )
  }
  const args = frame.argumentsFor(frameCall)
  requireRole(
    args &&
      args[0]?.type === 'ThisExpression' &&
      (!frame.entry.method ||
        (frame.entry.method.owner === constructorBinding &&
          precedes(
            context.paths.get(frame.entry.method.assignment),
            context.paths.get(boot),
          ))),
    'LOAD_CONST frame helper is not stable and top-level in the closed entry shape',
  )
  if (frame.entry.method)
    selectedMethodOwnership(
      context,
      constructorBinding,
      frame.entry.method.name,
      frame.entry.method.assignment,
      frameCall,
    )
  const vm = frame.local.get('vm')
  const activeFields = new Set([
    ...fields,
    ...[...frame.local]
      .filter(([name]) => name.endsWith('Field'))
      .map(([, value]) => value),
  ])
  const effects = graph.effects.filter(
    (effect) => effect.functionNode === frame.entry.fn,
  )
  requireRole(
    effects.every(
      (effect) =>
        !activeFields.has(effect.field) &&
        (vm === 'this'
          ? effect.receiver.type === 'ThisExpression'
          : context.sameRef(effect.receiver, vm)),
    ),
    'LOAD_CONST frame helper effects are outside the closed entry shape',
  )
  requireRole(
    frameCall.arguments.every((argument) =>
      inert(argument, context, parameters),
    ) &&
      args.slice(1).every((argument) => inert(argument, context, parameters)),
    'LOAD_CONST frame call effects are outside the closed entry shape',
  )
  const prefix = loopPath.node.body.body.slice(
    0,
    loopPath.node.body.body.indexOf(tryPath.node),
  )
  const base = tryPath.node.block.body.slice(
    0,
    tryPath.node.block.body.indexOf(switchPath.node),
  )
  const roles = new Map([['vm', 'this']])
  const patterns = [false, true].map((swapped) =>
    shape(
      parse(`function role(){for(;;){
    ${swapped ? '$regs=$vm.$regsField;$fp=$vm.$frameField;' : '$fp=$vm.$frameField;$regs=$vm.$regsField;'}
    $pc=$regs[$fp+0];if($pc>=$vm.$wordsField.length)break;
    $regs[$fp+0]=$pc+1;$pc=$vm.$wordsField[$pc];$base=$regs[$fp+7];}}`).program
        .body[0].body.body[0].body,
    ),
  )
  requireRole(
    patterns.some((pattern) =>
      match(
        pattern,
        shape([...prefix, ...base], true),
        context,
        new Map(roles),
      ),
    ),
    'LOAD_CONST dispatch effects are outside the closed entry shape',
  )
  const argument = args[2]
  const index = dispatchPath.node.params.findIndex(
    (param) => context.bindingFor(param) === context.bindingFor(argument),
  )
  const rootArgs = index >= 0 ? boot.expression.arguments[index] : argument
  requireRole(
    !rootArgs ||
      rootArgs.type === 'NullLiteral' ||
      (rootArgs.type === 'UnaryExpression' &&
        rootArgs.operator === 'void' &&
        numberValue(rootArgs.argument) === 0),
    'LOAD_CONST root frame arguments are outside the closed entry shape',
  )
  return {
    scope: 'selected-entry',
    frameDummyWrites: effects.map((effect) => ({
      field: effect.field,
      parameterIndex: frame.entry.fn.params.findIndex(
        (param) =>
          context.bindingFor(param) === context.bindingFor(effect.value),
      ),
      argument: 'inert transported value',
    })),
    laterHandlers: 'unproved',
  }
}

function selectedMethodOwnership(
  context,
  constructorBinding,
  name,
  definition,
  call,
  dispatchProved = false,
) {
  requireRole(
    constructorBinding?.constantViolations.length === 0,
    'LOAD_CONST VM constructor binding is unstable',
  )
  const prototype = (node) =>
    node?.type === 'MemberExpression' &&
    memberKey(node) === 'prototype' &&
    context.bindingFor(node.object) === constructorBinding
  const aliases = new Set()
  const isPrototype = (node) =>
    prototype(node) || aliases.has(context.bindingFor(node))
  const nodes = context.nodes(context.program)
  let changed = true
  while (changed) {
    changed = false
    for (const { node } of nodes) {
      const target =
        node.type === 'VariableDeclarator'
          ? node.id
          : node.type === 'AssignmentExpression' && node.operator === '='
            ? node.left
            : null
      const value = node.type === 'VariableDeclarator' ? node.init : node.right
      const binding = context.bindingFor(target)
      if (binding && isPrototype(value) && !aliases.has(binding)) {
        aliases.add(binding)
        changed = true
      }
    }
  }
  requireRole(
    [...aliases].every((binding) => binding.constantViolations.length === 0),
    'LOAD_CONST selected method prototype alias is unstable',
  )
  for (const { node, path } of nodes) {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      [
        'defineProperty',
        'defineProperties',
        'assign',
        'setPrototypeOf',
      ].includes(memberKey(node.callee))
    ) {
      requireRole(
        !isPrototype(node.arguments[0]) &&
          !(
            node.arguments[1]?.type === 'StringLiteral' &&
            node.arguments[1].value === name
          ),
        'LOAD_CONST selected method ownership has an indirect property effect',
      )
    }
    const target =
      node.type === 'AssignmentExpression'
        ? node.left
        : node.type === 'UpdateExpression'
          ? node.argument
          : node.type === 'UnaryExpression' && node.operator === 'delete'
            ? node.argument
            : null
    if (target) {
      requireRole(
        !prototype(target),
        'LOAD_CONST selected method prototype is replaced or deleted',
      )
      if (target.type === 'MemberExpression') {
        const key = memberKey(target)
        const ownedPrototype = isPrototype(target.object)
        requireRole(
          !(ownedPrototype && key === null),
          'LOAD_CONST selected method ownership has an unknown property write',
        )
        requireRole(
          node === definition || key !== name,
          'LOAD_CONST selected method is overwritten, deleted or shadowed',
        )
      } else if (
        target.type === 'ObjectPattern' ||
        target.type === 'ArrayPattern'
      ) {
        requireRole(
          !context
            .nodes(target)
            .some(
              ({ node: child }) =>
                child.type === 'MemberExpression' &&
                (prototype(child) ||
                  memberKey(child) === name ||
                  isPrototype(child.object)),
            ),
          'LOAD_CONST selected method ownership has a destructuring write',
        )
      }
    }
    // Prototype references may only form member accesses or stable explicit
    // aliases. Calls/escapes cannot establish the selected member's ownership.
    if (
      prototype(node) ||
      (node.type === 'Identifier' &&
        context.isReference(node, context.bindingFor(node)) &&
        isPrototype(node))
    ) {
      const parent = path.parentPath.node
      requireRole(
        (parent.type === 'MemberExpression' && parent.object === node) ||
          (parent.type === 'VariableDeclarator' &&
            parent.init === node &&
            aliases.has(context.bindingFor(parent.id))),
        'LOAD_CONST selected method prototype escapes the owned graph',
      )
    }
    if (
      node.type === 'Identifier' &&
      context.isReference(node, constructorBinding)
    ) {
      const parent = path.parentPath.node
      requireRole(
        (parent.type === 'NewExpression' && parent.callee === node) ||
          (parent.type === 'MemberExpression' &&
            parent.object === node &&
            memberKey(parent) === 'prototype'),
        'LOAD_CONST VM constructor escapes the selected ownership graph',
      )
    }
  }
  const constructor = constructorBinding.path.node
  for (const { node, path } of context.nodes(constructor)) {
    if (node.type !== 'ThisExpression') continue
    requireRole(
      path.parentPath.node.type === 'MemberExpression' &&
        path.parentPath.node.object === node &&
        memberKey(path.parentPath.node) !== null,
      'LOAD_CONST constructor receiver escapes the selected ownership graph',
    )
  }
  const dispatchPath = context.paths.get(call).getFunctionParent()
  if (dispatchPath.node.type === 'FunctionExpression') {
    const entry = ownedFunctions(context, null).functions.find(
      ({ fn }) => fn === dispatchPath.node,
    )
    requireRole(
      entry?.method?.owner === constructorBinding,
      'LOAD_CONST selected method dispatch is detached from VM prototype',
    )
    if (!dispatchProved)
      selectedMethodOwnership(
        context,
        constructorBinding,
        entry.method.name,
        entry.method.assignment,
        call,
        true,
      )
    // closedMethodEntryEffects proves the complete prelude, including its
    // selected frame method. Constructor ownership alone never admits it.
    return
  }
  requireRole(
    dispatchPath.node.type === 'FunctionDeclaration',
    'LOAD_CONST selected method requires a proved helper dispatch receiver',
  )
  if (dispatchPath.node.type === 'FunctionDeclaration') {
    const vm = context.bindingFor(dispatchPath.node.params[0])
    const switchPath = context.paths
      .get(call)
      .findParent((path) => path.isSwitchStatement())
    for (const { node, path } of context.nodes(dispatchPath.node)) {
      if (!context.isReference(node, vm) || !precedes(path, switchPath))
        continue
      const parent = path.parentPath.node
      if (
        parent.type === 'MemberExpression' &&
        parent.object === node &&
        memberKey(parent) !== null
      ) {
        const use = path.parentPath.parentPath.node
        requireRole(
          !(use.type === 'CallExpression' && use.callee === parent),
          'LOAD_CONST selected VM receiver has an unknown prelude method effect',
        )
        continue
      }
      requireRole(
        parent.type === 'CallExpression' && parent.callee.type === 'Identifier',
        'LOAD_CONST selected VM receiver escapes before the selected call',
      )
      const helper = context.bindingFor(parent.callee)
      const index = parent.arguments.indexOf(node)
      requireRole(
        helper?.path.node.type === 'FunctionDeclaration' &&
          context.paths.get(helper.path.node).parentPath.isProgram() &&
          helper.constantViolations.length === 0 &&
          index >= 0,
        'LOAD_CONST selected VM receiver escapes before the selected call',
      )
      const helperVM = context.bindingFor(helper.path.node.params[index])
      requireRole(
        helperVM &&
          context
            .nodes(helper.path.node)
            .every(({ node: child, path: childPath }) => {
              if (!context.isReference(child, helperVM)) return true
              const member = childPath.parentPath.node
              const use = childPath.parentPath.parentPath.node
              return (
                member.type === 'MemberExpression' &&
                member.object === child &&
                memberKey(member) !== null &&
                memberKey(member) !== name &&
                !(use.type === 'CallExpression' && use.callee === member)
              )
            }),
        'LOAD_CONST selected VM receiver has an unknown prelude helper effect',
      )
    }
  }
}

function ownedFunction(
  context,
  call,
  receiver,
  constructorBinding,
  boot,
  deferEntry,
) {
  requireRole(
    call?.type === 'CallExpression',
    'LOAD_CONST reader is not a call',
  )
  if (call.callee.type === 'Identifier') {
    const binding = context.bindingFor(call.callee)
    const fn = binding?.path.node
    requireRole(
      fn?.type === 'FunctionDeclaration' &&
        context.paths.get(fn).parentPath.isProgram() &&
        binding.constantViolations.length === 0,
      'LOAD_CONST reader helper binding is not stable and top-level',
    )
    const indexes = call.arguments
      .map((argument, index) => (receiver(argument) ? index : -1))
      .filter((index) => index >= 0)
    requireRole(
      indexes.length === 1 &&
        call.arguments.every(
          (argument, index) => index === indexes[0] || inert(argument, context),
        ),
      'LOAD_CONST reader uses a different VM receiver',
    )
    requireRole(
      fn.params.every((param) => context.bindingFor(param)) &&
        context.bindingFor(fn.params[indexes[0]]),
      'LOAD_CONST helper receiver parameter is missing',
    )
    const parameterIndex = indexes[0]
    return {
      fn,
      kind: 'helper',
      receiver: context.bindingFor(fn.params[parameterIndex]),
      parameterIndex,
      argumentsFor(actual) {
        if (
          actual?.type !== 'CallExpression' ||
          context.bindingFor(actual.callee) !== binding ||
          actual.arguments.length <= parameterIndex ||
          actual.arguments.some(
            (argument, index) =>
              index !== parameterIndex && !inert(argument, context),
          )
        )
          return null
        return [actual.arguments[parameterIndex]]
      },
    }
  }
  requireRole(
    call.callee.type === 'MemberExpression' &&
      !call.callee.computed &&
      receiver(call.callee.object) &&
      (call.arguments.length === 0 ||
        (deferEntry && call.arguments.every((arg) => inert(arg, context)))),
    'LOAD_CONST reader uses a different VM receiver',
  )
  const name = propertyName(call.callee.property)
  const assignments = context
    .nodes(context.program)
    .filter(({ node: expression }) => {
      const left = expression?.left
      return (
        expression?.type === 'AssignmentExpression' &&
        left?.type === 'MemberExpression' &&
        !left.computed &&
        propertyName(left.property) === name &&
        left.object?.type === 'MemberExpression' &&
        !left.object.computed &&
        propertyName(left.object.property) === 'prototype' &&
        context.bindingFor(left.object.object) === constructorBinding
      )
    })
  requireRole(
    assignments.length === 1 &&
      assignments[0].path.parentPath.isExpressionStatement() &&
      assignments[0].path.parentPath.parentPath.isProgram() &&
      precedes(assignments[0].path, context.paths.get(boot)) &&
      assignments[0].node.operator === '=' &&
      assignments[0].node.right.type === 'FunctionExpression',
    'LOAD_CONST reader method is detached from VM prototype',
  )
  const fn = assignments[0].node.right
  selectedMethodOwnership(
    context,
    constructorBinding,
    name,
    assignments[0].node,
    call,
  )
  const entryEffects = deferEntry
    ? null
    : closedEntryEffects(context, call, constructorBinding, name, boot)
  requireRole(
    !fn.async &&
      !fn.generator &&
      fn.params.every((param) => context.bindingFor(param)),
    'LOAD_CONST method parameters are unsupported',
  )
  return {
    fn,
    kind: 'method',
    receiver: 'this',
    entryEffects,
    argumentsFor(actual) {
      if (
        actual?.type !== 'CallExpression' ||
        actual.callee?.type !== 'MemberExpression' ||
        actual.callee.computed ||
        propertyName(actual.callee.property) !== name ||
        actual.arguments.some((arg) => !inert(arg, context))
      )
        return null
      return [actual.callee.object]
    },
  }
}

function rolesFor(reader, fields, frame) {
  return new Map([
    ['vm', reader.receiver],
    ['words', fields.words],
    ['pool', fields.pool],
    ['regs', frame.regs],
    ['frame', frame.frame],
  ])
}

function observedAssignment(context, fn, binding, predicate) {
  return context
    .nodes(fn)
    .filter(
      ({ node, path }) =>
        path.getFunctionParent()?.node === fn &&
        ((node.type === 'VariableDeclarator' &&
          context.bindingFor(node.id) === binding &&
          predicate(node.init)) ||
          (node.type === 'AssignmentExpression' &&
            node.operator === '=' &&
            context.bindingFor(node.left) === binding &&
            predicate(node.right))),
    )
}

function writesBinding(context, node, binding) {
  if (!node) return false
  if (node.type === 'Identifier') return context.bindingFor(node) === binding
  if (node.type === 'RestElement')
    return writesBinding(context, node.argument, binding)
  if (node.type === 'AssignmentPattern')
    return writesBinding(context, node.left, binding)
  if (node.type === 'ArrayPattern')
    return node.elements.some((item) => writesBinding(context, item, binding))
  if (node.type === 'ObjectPattern')
    return node.properties.some((item) =>
      writesBinding(
        context,
        item.type === 'RestElement' ? item.argument : item.value,
        binding,
      ),
    )
  return false
}

function possibleWrites(context, fn, binding) {
  return context
    .nodes(fn)
    .filter(
      ({ node }) =>
        (node.type === 'VariableDeclarator' &&
          node.init &&
          writesBinding(context, node.id, binding)) ||
        (node.type === 'AssignmentExpression' &&
          writesBinding(context, node.left, binding)) ||
        (node.type === 'UpdateExpression' &&
          writesBinding(context, node.argument, binding)) ||
        ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') &&
          (node.left.type === 'VariableDeclaration'
            ? node.left.declarations.some((item) =>
                writesBinding(context, item.id, binding),
              )
            : writesBinding(context, node.left, binding))),
    )
}

function outsideSelectedSwitch(path, selectedSwitch) {
  return !path.findParent((parent) => parent.node === selectedSwitch)
}

function readerBody(context, reader, coreFields, role = 'constant') {
  const graph = ownedFunctions(context, null)
  const parameters = new Set(
    reader.fn.params.map((param) => context.bindingFor(param)),
  )
  const removed = []
  let repurposed = false
  const body = shape(reader.fn.body).filter((statement) => {
    if (
      reader.receiver !== 'this' &&
      statement.type === 'AssignmentExpression' &&
      context.bindingFor(statement.left) === reader.receiver
    )
      repurposed = true
    const left = statement.left
    const receiver =
      reader.receiver === 'this'
        ? left?.object?.type === 'ThisExpression'
        : context.sameRef(left?.object, reader.receiver)
    if (
      statement.type !== 'AssignmentExpression' ||
      statement.operator !== '=' ||
      left?.type !== 'MemberExpression' ||
      left.computed ||
      !receiver
    )
      return true
    const name = propertyName(left.property)
    const voidZero =
      statement.right?.type === 'UnaryExpression' &&
      statement.right.operator === 'void' &&
      numberValue(statement.right.argument) === 0
    const transported =
      parameters.has(context.bindingFor(statement.right)) ||
      (statement.right?.type === 'ArrayExpression' &&
        statement.right.elements.every((item) =>
          parameters.has(context.bindingFor(item)),
        ))
    requireRole(
      !repurposed &&
        !coreFields.has(name) &&
        (voidZero || (transported && graph.writesOnly.has(name))) &&
        inert(statement.right, context, parameters),
      `LOAD_CONST ${role} reader has unsupported VM field effects`,
    )
    removed.push(name)
    return false
  })
  if (reader.kind === 'helper') {
    const incoming = clauseLiveness(body, (node) => context.bindingFor(node))
    requireRole(
      reader.fn.params.every(
        (param, index) =>
          index === reader.parameterIndex ||
          !incoming.has(context.bindingFor(param)),
      ),
      'LOAD_CONST dummy parameter affects retained reader logic',
    )
  }
  return { body, removed }
}

export function observeMinifiedClassLoadConstant(
  context,
  { dispatch, constructorBinding, fields, frame, boot, deferEntry = false },
) {
  requireRole(
    constructorBinding?.constantViolations.length === 0,
    'LOAD_CONST VM constructor binding is unstable',
  )
  const fn = dispatch.fn
  const dispatchVM = context.bindingFor(fn.params[0])
  const receiver =
    fn.type === 'FunctionExpression'
      ? (node) => node?.type === 'ThisExpression'
      : (node) => context.sameRef(node, dispatchVM)
  const field = (node, name) =>
    node?.type === 'MemberExpression' &&
    !node.computed &&
    propertyName(node.property) === name &&
    receiver(node.object)
  const selected = dispatch.switchNode.cases.find(
    (item) => numberValue(item.test) === EXPECTED_OPCODES.LOAD_CONST,
  )
  const statements = selected.consequent
  requireRole(
    statements.length === 3 &&
      statements[0].type === 'VariableDeclaration' &&
      statements[0].kind === 'var' &&
      statements[0].declarations.length === 1 &&
      statements[1].type === 'ExpressionStatement' &&
      statements[1].expression.type === 'AssignmentExpression' &&
      statements[1].expression.operator === '=' &&
      statements[2].type === 'BreakStatement' &&
      !statements[2].label,
    'LOAD_CONST case shape is incomplete',
  )
  const destination = statements[0].declarations[0]
  const write = statements[1].expression
  const dst = context.bindingFor(destination.id)
  const address = write.left?.property
  const regs = context.bindingFor(write.left?.object)
  const base = context.bindingFor(address?.left)
  requireRole(
    dst &&
      regs &&
      base &&
      write.left.type === 'MemberExpression' &&
      write.left.computed &&
      address?.type === 'BinaryExpression' &&
      address.operator === '+' &&
      context.sameRef(address.right, dst),
    'LOAD_CONST destination is detached from operand register',
  )
  const switchPath = context.paths.get(dispatch.switchNode)
  const loop = switchPath.findParent((path) => path.isForStatement())
  const before = (entry) => {
    if (
      !precedes(entry.path, switchPath) ||
      entry.path.findParent((path) => path.isForStatement())?.node !== loop.node
    )
      return false
    for (
      let path = entry.path.parentPath;
      path?.node !== loop.node;
      path = path.parentPath
    )
      if (
        path.isIfStatement() ||
        path.isConditionalExpression() ||
        path.isLogicalExpression() ||
        path.isLoop() ||
        path.isSwitchCase() ||
        path.isCatchClause() ||
        path.isFunction()
      )
        return false
    return true
  }
  const regsReads = observedAssignment(context, fn, regs, (node) =>
    field(node, frame.regs),
  ).filter(before)
  const frameReads = context
    .nodes(fn)
    .filter(
      ({ node, path }) =>
        path.getFunctionParent()?.node === fn &&
        before({ path }) &&
        ((node.type === 'VariableDeclarator' &&
          field(node.init, frame.frame)) ||
          (node.type === 'AssignmentExpression' &&
            node.operator === '=' &&
            field(node.right, frame.frame))),
    )
  requireRole(
    regsReads.length === 1 && frameReads.length === 1,
    'LOAD_CONST dispatch registers are detached from observed VM frame',
  )
  const fp = context.bindingFor(
    frameReads[0].node.id ?? frameReads[0].node.left,
  )
  const baseReads = observedAssignment(
    context,
    fn,
    base,
    (node) =>
      node?.type === 'MemberExpression' &&
      node.computed &&
      context.sameRef(node.object, regs) &&
      node.property?.type === 'BinaryExpression' &&
      node.property.operator === '+' &&
      context.sameRef(node.property.left, fp) &&
      numberValue(node.property.right) === 7,
  ).filter(before)
  requireRole(
    baseReads.length === 1,
    'LOAD_CONST register base is detached from observed frame slot',
  )
  requireRole(
    precedes(regsReads[0].path, baseReads[0].path) &&
      precedes(frameReads[0].path, baseReads[0].path),
    'LOAD_CONST register base read precedes its frame inputs',
  )
  const definitions = new Map([
    [regs, regsReads[0].node],
    [fp, frameReads[0].node],
    [base, baseReads[0].node],
  ])
  requireRole(
    new Set([regs, fp, base, dst]).size === 4 &&
      [regs, fp, base].every(
        (binding) =>
          possibleWrites(context, fn, binding).filter(
            ({ node, path }) =>
              node !== definitions.get(binding) &&
              outsideSelectedSwitch(path, dispatch.switchNode) &&
              precedes(path, switchPath),
          ).length === 0,
      ),
    'LOAD_CONST dispatch role bindings are overwritten or aliased',
  )
  requireRole(
    fn.type !== 'FunctionDeclaration' ||
      possibleWrites(context, fn, dispatchVM).filter(
        ({ path }) =>
          outsideSelectedSwitch(path, dispatch.switchNode) &&
          precedes(path, switchPath),
      ).length === 0,
    'LOAD_CONST dispatch VM receiver is overwritten',
  )
  const operand = ownedFunction(
    context,
    destination.init,
    receiver,
    constructorBinding,
    boot,
    deferEntry,
  )
  const operandRoles = rolesFor(operand, fields, frame)
  const coreFields = new Set([
    ...Object.values(fields),
    frame.regs,
    frame.top,
    frame.frame,
  ])
  const operandBody = readerBody(context, operand, coreFields, 'operand')
  requireRole(
    match(operandPattern, operandBody.body, context, operandRoles),
    'LOAD_CONST operand reader does not read and advance observed frame PC',
  )
  const constant = ownedFunction(
    context,
    write.right,
    receiver,
    constructorBinding,
    boot,
    deferEntry,
  )
  const { body, removed: incidentalWrites } = readerBody(
    context,
    constant,
    coreFields,
  )
  let constantRoles
  let constantPattern
  for (const { pattern, separateState, method } of constantPatterns) {
    if (method !== (constant.kind === 'method')) continue
    const roles = rolesFor(constant, fields, frame)
    roles.set('operand', context.bindingFor(operand.fn.id))
    // A single Weyl binding is the key unless the body explicitly copies it.
    const candidate = new Map(roles)
    if (
      match(
        pattern,
        body,
        context,
        candidate,
        false,
        new Map(
          operand.argumentsFor ? [['operand', operand.argumentsFor]] : [],
        ),
      )
    ) {
      if (!separateState) candidate.set('state', candidate.get('key'))
      if (separateState || candidate.get('state') === candidate.get('key')) {
        constantRoles = candidate
        constantPattern = pattern
        break
      }
    }
  }
  requireRole(
    constantRoles,
    'LOAD_CONST constant reader body does not implement observed pool decoding',
  )
  const role = (key) => constantRoles.get(key)
  const localKeys = [
    'index',
    'key',
    'value',
    'out',
    'state',
    'counter',
    ...(constantRoles.has('buffer') ? ['buffer'] : []),
  ]
  requireRole(
    localKeys.every((key) => role(key)?.scope.path.node === constant.fn) &&
      role('index') !== role('key') &&
      role('key') !== role('value') &&
      role('index') !== constant.receiver &&
      role('key') !== constant.receiver &&
      compatibleRoleBindings(constantPattern, constantRoles) &&
      (constant.kind !== 'method' ||
        ['inputIndex', 'inputKey'].every((key) =>
          constant.fn.params.some(
            (param) => context.bindingFor(param) === role(key),
          ),
        )),
    'LOAD_CONST constant reader bindings alias incompatible roles',
  )
  const bytesBinding = constantRoles.get('bytes')
  const bytes = bytesBinding?.path.node
  requireRole(
    bytes?.type === 'FunctionDeclaration' &&
      context.paths.get(bytes).parentPath.isProgram() &&
      bytesBinding.constantViolations.length === 0 &&
      bytes.params.length === 1 &&
      !bytes.async &&
      !bytes.generator,
    'LOAD_CONST byte reader helper binding is not stable and top-level',
  )
  const byteRoles = new Map([['value', context.bindingFor(bytes.params[0])]])
  requireRole(
    match(bytesPattern, shape(bytes.body), context, byteRoles),
    'LOAD_CONST byte reader does not implement base64 byte conversion',
  )
  requireRole(
    !operand.fn.async &&
      !operand.fn.generator &&
      !constant.fn.async &&
      !constant.fn.generator,
    'LOAD_CONST reader function kind is unsupported',
  )
  return {
    opcode: EXPECTED_OPCODES.LOAD_CONST,
    operand: { kind: operand.kind, pcSlot: 0, advance: 'post-increment' },
    constant: {
      kind: constant.kind,
      operands: ['pool-index', 'conceal-key'],
      incidentalWrites,
    },
    destination: { baseSlot: 7, index: 'first-word-operand' },
    entryEffects: constant.entryEffects ?? null,
    completeHandlers: false,
  }
}
