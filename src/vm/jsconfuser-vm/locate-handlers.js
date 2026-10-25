import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { locateBootSkeleton } from './locate-boot-payload.js'
import { cloneRuntimeFragment } from './runtime-fragment-pattern.js'
import { createOpcodeTable } from './opcode-table.js'
import {
  isControlBodyKey,
  simpleControlBody,
} from '../../visitor/jsconfuser-vm/normalize-source.js'
import {
  ContainerDecline,
  decline,
  deepFreeze,
  isStableDeclaration,
  makeContext,
  numberValue,
  propertyName,
  prototypeMethods,
  topLevelDeclarations,
} from './container-role-helpers.js'

// The handler locator finds the interpreter by what it does, never by names: the boot call enters
// the run loop with the VM its construction filled from the payload; the loop fetches the word at
// the frame's PC from the VM's word field and dispatches on it. Operand and constant readers are
// the functions whose bodies read that field and the pool field. Class obfuscation, minify
// devirtualization and case shuffle re-spell these pieces and keep the behaviour.

function isDummyLiteral(node) {
  return (
    (node?.type === 'UnaryExpression' &&
      node.operator === 'void' &&
      node.argument.type === 'NumericLiteral') ||
    node?.type === 'NullLiteral' ||
    node?.type === 'NumericLiteral' ||
    node?.type === 'StringLiteral' ||
    (node?.type === 'Identifier' && node.name === 'undefined') ||
    (node?.type === 'ArrayExpression' && node.elements.length === 0) ||
    (node?.type === 'ObjectExpression' && node.properties.length === 0)
  )
}

function within(path, ancestor) {
  for (let current = path; current; current = current.parentPath) {
    if (current.node === ancestor) return true
  }
  return false
}

function fakeExpression(node, parameters, context) {
  if (node?.type === 'Identifier')
    return parameters.has(context.bindingFor(node))
  if (node?.type !== 'ArrayExpression' && node?.type !== 'LogicalExpression')
    return isDummyLiteral(node)
  if (node?.type === 'ArrayExpression')
    return node.elements.every((item) =>
      fakeExpression(item, parameters, context),
    )
  if (node?.type === 'LogicalExpression')
    return (
      ['&&', '||'].includes(node.operator) &&
      fakeExpression(node.left, parameters, context) &&
      fakeExpression(node.right, parameters, context)
    )
  return false
}

function functionOf(declaration) {
  return declaration.init?.type === 'FunctionDeclaration' ||
    declaration.init?.type === 'FunctionExpression'
    ? declaration.init
    : null
}

// The function a top-level binding stably holds, through stable aliases such as `var a = b`.
function functionFor(context, declarations, node, seen = new Set()) {
  const binding = context.bindingFor(node)
  if (!binding || seen.has(binding)) return null
  seen.add(binding)
  const found = declarations.filter((item) => item.binding === binding)
  if (found.length === 1 && isStableDeclaration(found[0])) {
    if (found[0].kind === 'function') return found[0]
    if (found[0].init?.type === 'Identifier')
      return functionFor(context, declarations, found[0].init, seen)
    return null
  }
  // A declarator outside the top-level statements (a for-loop initializer) that is never written.
  const alias = binding.path.isVariableDeclarator()
    ? binding.path.node.init
    : null
  return found.length === 0 &&
    binding.constantViolations.length === 0 &&
    alias?.type === 'Identifier'
    ? functionFor(context, declarations, alias, seen)
    : null
}

// Class obfuscation adds decoy parameters and stores them into a new field nothing reads; its call
// sites pass dummy literals for them. Minify then moves the store and may reuse the parameter as a
// local. The store is removed first: a write of parameters or dummy literals into the receiver's
// field (`this` in a method, the first parameter in a devirtualized function) that no code reads.
// A parameter is then dead when nothing reads it, or when its first use overwrites it.
function callableLayout(context, fn, isSelf, readFields) {
  if (!fn.params.every((param) => param.type === 'Identifier')) return null
  const bindings = fn.params.map((param) => context.bindingFor(param))
  const parameters = new Set(bindings)
  const decoyWrites = context
    .nodes(fn)
    .map(({ node }) => node)
    .filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.operator === '=' &&
        node.left?.type === 'MemberExpression' &&
        !node.left.computed &&
        isSelf(node.left.object) &&
        fakeExpression(node.right, parameters, context) &&
        !readFields.has(propertyName(node.left.property)),
    )
  const decoys = new Set()
  for (const [index, binding] of bindings.entries()) {
    // A use reads the parameter (a compound assignment reads its target too) or overwrites it.
    const overwrites = (path) =>
      path.parentPath.isAssignmentExpression({ operator: '=' }) &&
      path.key === 'left' &&
      context.bindingFor(path.node) === binding
    const uses = context
      .nodes(fn)
      .filter(
        ({ node, path }) =>
          node.type === 'Identifier' &&
          (context.isReference(node, binding) ||
            (path.parentPath.isAssignmentExpression() &&
              path.key === 'left' &&
              context.bindingFor(node) === binding)) &&
          !decoyWrites.some((write) => within(path, write.right)),
      )
      .sort((left, right) => left.node.start - right.node.start)
    const first = uses[0]?.path
    if (
      !first ||
      (overwrites(first) &&
        !context
          .nodes(first.parent.right)
          .some(({ node }) => context.isReference(node, binding)))
    )
      decoys.add(index)
  }
  // Arguments past the parameters are never read unless the body uses `arguments`.
  const readsArguments = context
    .nodes(fn)
    .some(
      ({ node, path }) =>
        node.type === 'Identifier' &&
        node.name === 'arguments' &&
        path.getFunctionParent()?.node === fn,
    )
  return {
    arity: bindings.length,
    decoys,
    decoyWrites,
    bindings,
    readsArguments,
  }
}

// The number a value always holds: a literal, a top-level binding stably holding one (an
// object-extracted map member, `var x;` with its single top-level `x = 7`), or a stable numeric
// map's member (`OP.ADD`). Each spells the same case label or frame offset.
function labelValue(context, declarations, test) {
  const literal = numberValue(test)
  if (Number.isSafeInteger(literal)) return literal
  if (test?.type === 'Identifier') {
    const binding = context.bindingFor(test)
    const held = declarations.find(
      (item) =>
        item.kind === 'variable' &&
        binding &&
        item.binding === binding &&
        isStableDeclaration(item),
    )
    const value = numberValue(held?.init)
    return Number.isSafeInteger(value) ? value : null
  }
  if (test?.type !== 'MemberExpression' || test.computed) return null
  const binding = context.bindingFor(test.object)
  const map = declarations.find(
    (item) =>
      item.kind === 'variable' &&
      item.binding === binding &&
      isStableDeclaration(item) &&
      item.init?.type === 'ObjectExpression',
  )
  if (!map) return null
  const key = propertyName(test.property)
  const property = map.init.properties.find(
    (item) =>
      item.type === 'ObjectProperty' &&
      !item.computed &&
      propertyName(item.key) === key,
  )
  const value = numberValue(property?.value)
  return Number.isSafeInteger(value) ? value : null
}

function caseStatements(entry) {
  return entry.consequent.length === 1 &&
    entry.consequent[0].type === 'BlockStatement'
    ? entry.consequent[0].body
    : entry.consequent
}

// `this.field = parameter` statements directly in a constructor body, by parameter position.
function storedFields(context, fn) {
  const fields = new Map()
  for (const statement of fn.body.body) {
    const node = statement.expression
    if (
      statement.type !== 'ExpressionStatement' ||
      node?.type !== 'AssignmentExpression' ||
      node.operator !== '=' ||
      node.left.type !== 'MemberExpression' ||
      node.left.computed ||
      node.left.object.type !== 'ThisExpression'
    )
      continue
    const binding = context.bindingFor(node.right)
    const index = fn.params.findIndex(
      (param) => context.bindingFor(param) === binding,
    )
    if (binding && index >= 0)
      fields.set(index, propertyName(node.left.property))
  }
  return fields
}

function locate(ast) {
  const context = makeContext(ast)
  const declarations = topLevelDeclarations(context)
  const { call, holder, wordsIndex, poolIndex } = locateBootSkeleton(ast)
  const vm = functionFor(context, declarations, holder.callee)
  const vmFunction = vm && functionOf(vm)
  if (!vmFunction) decline('handler-locator', 'VM construction is not unique')
  const fields = storedFields(context, vmFunction)
  const wordsField = fields.get(wordsIndex)
  const poolField = fields.get(poolIndex)
  if (!wordsField || !poolField)
    decline('handler-locator', 'VM payload fields are not stored')

  // Every method (by unique name) and top-level function with its decoy layout.
  const isThis = (node) => node?.type === 'ThisExpression'
  const owners = declarations.filter(
    (item) =>
      item.kind === 'function' && prototypeMethods(context, item).length > 0,
  )
  const methodCounts = new Map()
  for (const owner of owners)
    for (const { name } of prototypeMethods(context, owner))
      methodCounts.set(name, (methodCounts.get(name) ?? 0) + 1)
  // Field names some code reads: a member access other than a plain write's target.
  const readFields = new Set(
    context
      .nodes(context.program)
      .flatMap(({ node, path }) =>
        node.type === 'MemberExpression' &&
        (!node.computed || node.property.type === 'StringLiteral') &&
        !(
          path.parentPath.isAssignmentExpression({ operator: '=' }) &&
          path.key === 'left'
        )
          ? [propertyName(node.property)]
          : [],
      ),
  )
  const callables = []
  for (const owner of owners)
    for (const { name, fn } of prototypeMethods(context, owner)) {
      if (methodCounts.get(name) !== 1) continue
      const layout = callableLayout(context, fn, isThis, readFields)
      if (layout) callables.push({ kind: 'method', name, fn, owner, ...layout })
    }
  for (const item of declarations) {
    const fn = item.kind === 'function' ? functionOf(item) : null
    if (!fn) continue
    const self = fn.params[0]
    // A devirtualized method writes through its first parameter; a constructor through `this`.
    const isSelf = (node) =>
      isThis(node) ||
      (self?.type === 'Identifier' &&
        context.isReference(node, context.bindingFor(self)))
    const layout = callableLayout(context, fn, isSelf, readFields)
    if (layout)
      callables.push({ kind: 'function', binding: item.binding, fn, ...layout })
  }
  const calleeOf = (node) => {
    if (node?.type !== 'CallExpression') return null
    const callee = node.callee
    // A method call on the VM: `this.m()` in a method, `vm.m()` in a devirtualized function.
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      isState(callee.object)
    ) {
      const name = propertyName(callee.property)
      return (
        callables.find(
          (item) => item.kind === 'method' && item.name === name,
        ) ?? null
      )
    }
    if (callee.type === 'Identifier') {
      const binding = context.bindingFor(callee)
      return (
        callables.find(
          (item) => item.kind === 'function' && item.binding === binding,
        ) ?? null
      )
    }
    return null
  }
  // A method call on any receiver (an upvalue cell's read, say), by the method's unique name.
  const methodOf = (node) =>
    node?.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed
      ? (callables.find(
          (item) =>
            item.kind === 'method' &&
            item.name === propertyName(node.callee.property),
        ) ?? null)
      : null
  // A call's arguments with decoys removed. Minify drops trailing arguments, and a missing
  // argument is undefined, so a call may pass fewer than the callable's arity.
  // A decoy argument is dead; it need only evaluate without effect: a dummy literal, or a bound
  // variable (Closure may pass one). An unbound name would throw.
  const deadArgument = (node) =>
    isDummyLiteral(node) ||
    (node?.type === 'Identifier' && context.bindingFor(node) !== null)
  const realArguments = (node, callable) => {
    const extra = callable.readsArguments
      ? []
      : node.arguments.slice(callable.arity)
    if (extra.length > 0 && extra.every(deadArgument))
      return realArguments(
        { ...node, arguments: node.arguments.slice(0, callable.arity) },
        callable,
      )
    if (callable.decoys.size === 0 || node.arguments.length === 0)
      return node.arguments
    if (
      node.arguments.length > callable.arity ||
      [...callable.decoys].some(
        (index) =>
          index < node.arguments.length && !deadArgument(node.arguments[index]),
      )
    )
      decline('handler-locator', 'Class decoy call arguments changed')
    return node.arguments.filter((_, index) => !callable.decoys.has(index))
  }

  // The run entry and how its body refers to the VM: `this` in a method, a parameter otherwise.
  let entry
  let stateBinding = null
  if (call.callee.type === 'MemberExpression' && !call.callee.computed) {
    const methods = prototypeMethods(context, vm).filter(
      (item) => item.name === propertyName(call.callee.property),
    )
    if (methods.length !== 1)
      decline('handler-locator', 'VM run method is not unique')
    entry = methods[0].fn
  } else {
    const run = functionFor(context, declarations, call.callee)
    entry = run && functionOf(run)
    const index = call.arguments.findIndex(
      (argument) =>
        argument === holder ||
        (argument.type === 'Identifier' &&
          declarations.some(
            (item) =>
              item.binding === context.bindingFor(argument) &&
              item.init === holder,
          )),
    )
    if (!entry || index < 0 || entry.params[index]?.type !== 'Identifier')
      decline('handler-locator', 'VM run function is not unique')
    stateBinding = context.bindingFor(entry.params[index])
  }
  const isState = (node) =>
    isThis(node) ||
    (stateBinding !== null && context.isReference(node, stateBinding))
  const isField = (node, field, object) =>
    node?.type === 'MemberExpression' &&
    !node.computed &&
    propertyName(node.property) === field &&
    object(node.object)

  // The fetch: a local of the run entry initialized by reading the word field at an index.
  const selectors = new Set()
  for (const { node, path } of context.nodes(entry)) {
    const read =
      node.type === 'VariableDeclarator'
        ? { id: node.id, value: node.init }
        : node.type === 'AssignmentExpression' &&
            node.operator === '=' &&
            node.left.type === 'Identifier'
          ? { id: node.left, value: node.right }
          : null
    if (
      read?.value?.type === 'MemberExpression' &&
      read.value.computed &&
      isField(read.value.object, wordsField, isState) &&
      path.getFunctionParent()?.node === entry
    ) {
      const binding = context.bindingFor(read.id)
      if (binding) selectors.add(binding)
    }
  }
  const switches = context
    .nodes(entry)
    .filter(
      ({ node }) =>
        node.type === 'SwitchStatement' &&
        [...selectors].some((binding) =>
          context.isReference(node.discriminant, binding),
        ),
    )
  // A handler table dispatches by calling the state's member named by the fetched word.
  const tableCalls = context
    .nodes(entry)
    .filter(
      ({ node }) =>
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.computed &&
        isState(node.callee.object) &&
        [...selectors].some((binding) =>
          context.isReference(node.callee.property, binding),
        ),
    )
  if (switches.length + tableCalls.length !== 1)
    decline('handler-locator', 'Dispatch on the fetched word is not unique')
  const dispatch = (switches[0] ?? tableCalls[0]).node

  // A reader's receiver and its statements other than decoy writes.
  const selfOf = (callable) =>
    callable.kind === 'method'
      ? isThis
      : (node) =>
          callable.fn.params[0]?.type === 'Identifier' &&
          context.isReference(node, callable.bindings[0])
  const effectiveBody = (callable) =>
    callable.fn.body.body.filter(
      (statement) =>
        !(
          statement.type === 'ExpressionStatement' &&
          callable.decoyWrites.includes(statement.expression)
        ),
    )
  // Operand reader: returns the word at a post-incremented index.
  const operands = callables.filter((callable) => {
    const body = effectiveBody(callable)
    const value = body.length === 1 ? body[0].argument : null
    return (
      body[0]?.type === 'ReturnStatement' &&
      value?.type === 'MemberExpression' &&
      value.computed &&
      value.property.type === 'UpdateExpression' &&
      value.property.operator === '++' &&
      !value.property.prefix &&
      isField(value.object, wordsField, selfOf(callable))
    )
  })
  if (operands.length !== 1)
    decline('handler-locator', 'Operand reader is not unique')
  const operandReader = operands[0]
  const firstReal = (callable) => (callable.kind === 'function' ? 1 : 0)
  const readerArguments = (node, reader) => {
    if (calleeOf(node) !== reader) return null
    const args = realArguments(node, reader)
    if (reader.kind === 'function' && !isState(args[0])) return null
    return args.slice(firstReal(reader))
  }
  const operand = (node) => readerArguments(node, operandReader)?.length === 0

  // Constant reader: reads the pool field; its two operand parameters default to operand reads on
  // its own receiver (`C(a)`, `a.z(7)` in a devirtualized function, `this.Q()` in a method).
  const constants = callables.filter(
    (callable) =>
      callable !== operandReader &&
      context
        .nodes(callable.fn)
        .some(({ node }) => isField(node, poolField, selfOf(callable))),
  )
  if (constants.length !== 1)
    decline('handler-locator', 'Constant reader is not unique')
  const constantReader = constants[0]
  const defaulted = context.nodes(constantReader.fn).flatMap(({ node }) => {
    const pair =
      node.type === 'VariableDeclarator'
        ? [node.id, node.init]
        : node.type === 'AssignmentExpression' && node.operator === '='
          ? [node.left, node.right]
          : null
    const value = pair?.[1]
    const readsOperand = (node) =>
      calleeOf(node) === operandReader ||
      (methodOf(node) === operandReader &&
        selfOf(constantReader)(node.callee.object))
    if (
      value?.type !== 'LogicalExpression' ||
      value.operator !== '??' ||
      !readsOperand(value.right)
    )
      return []
    const index = constantReader.bindings.indexOf(
      context.bindingFor(value.left),
    )
    return index >= 0 ? [index] : []
  })
  const real = constantReader.bindings
    .map((_, index) => index)
    .filter(
      (index) =>
        !constantReader.decoys.has(index) && index >= firstReal(constantReader),
    )
  // Minify drops the pair when no handler passes it; the reader then reads both operands itself.
  if (
    ![0, 2].includes(defaulted.length) ||
    new Set(defaulted).size !== defaulted.length ||
    defaulted.some((index) => !real.includes(index))
  )
    decline('handler-locator', 'Constant reader parameters are ambiguous')
  // Explicit constant arguments in the reader's (index, key) order; a call passing none gives [].
  const constant = (node) => {
    if (calleeOf(node) !== constantReader) return null
    if (node.arguments.length === firstReal(constantReader)) {
      if (constantReader.kind === 'function' && !isState(node.arguments[0]))
        return null
      return []
    }
    const args = realArguments(node, constantReader)
    if (constantReader.kind === 'function' && !isState(node.arguments[0]))
      return null
    const kept = constantReader.bindings
      .map((_, index) => index)
      .filter((index) => !constantReader.decoys.has(index))
    if (args.length > kept.length) return null
    return defaulted.map((index) => args[kept.indexOf(index)])
  }

  const handlers = (
    dispatch.type === 'SwitchStatement'
      ? dispatch.cases
      : tableHandlers(context, declarations, vm)
  ).flatMap((item) => {
    if (item.type === 'TableHandler') return [item]
    if (!item.test) return []
    const label = labelValue(context, declarations, item.test)
    if (label === null)
      decline('handler-locator', 'Dispatch label has no value')
    const statements = caseStatements(item)
    // A case leaves the dispatch by `break`, or by ending the switch as its last case.
    const ends =
      statements.at(-1)?.type === 'BreakStatement' ||
      (item === dispatch.cases.at(-1) && !statements.some(t.isBreakStatement))
    return [{ label, entry: item, statements, ends, table: false }]
  })
  if (new Set(handlers.map(({ label }) => label)).size !== handlers.length)
    decline('handler-locator', 'Dispatch labels are not distinct')

  // Lower cloned handler statements for comparison: reader calls become `$operand()` and
  // `$constant(...)` with their explicit arguments, other calls lose decoy arguments, and each
  // statement-level write stands alone (`var x = v, y = w` and `x = v, y = w` read as `x = v;
  // y = w`). `origins` maps clones to the runtime's own nodes. `nodes` clone some of a handler's
  // `body`; for a table handler its prologue is cloned in front, and propagation consumes it.
  const lower = (nodes, origins, handler = null) => {
    if (handler?.table && handler.prologue.length > 0)
      nodes.unshift(...cloneRuntimeFragment(handler.prologue, origins).nodes)
    lowerShape(nodes, origins)
    if (handler?.table) ssaPropagate(nodes, origins, context, handler.entry)
    return nodes
  }
  const lowerShape = (nodes, origins) => {
    const original = (node) => origins?.get(node) ?? node
    // A File root gives every statement a parent path; the block keeps `nodes` as its body.
    traverse(t.file(t.program([t.blockStatement(nodes)])), {
      noScope: true,
      CallExpression(path) {
        const node = original(path.node)
        const callable = calleeOf(node) ?? methodOf(node)
        if (!callable) return
        const position = (argument) => node.arguments.indexOf(argument)
        const cloned = (argument) => path.node.arguments[position(argument)]
        if (callable === operandReader && operand(node)) {
          path.replaceWith(t.callExpression(t.identifier('$operand'), []))
          path.skip()
          return
        }
        const args = callable === constantReader ? constant(node) : null
        if (args) {
          path.node.callee = t.identifier('$constant')
          path.node.arguments = args.map(cloned)
          return
        }
        path.node.arguments = realArguments(node, callable).map(cloned)
      },
      NewExpression(path) {
        const node = original(path.node)
        const binding =
          node.callee.type === 'Identifier'
            ? context.bindingFor(node.callee)
            : null
        const callable = callables.find(
          (item) =>
            item.kind === 'function' && binding && item.binding === binding,
        )
        if (!callable) return
        const position = (argument) => node.arguments.indexOf(argument)
        path.node.arguments = realArguments(node, callable).map(
          (argument) => path.node.arguments[position(argument)],
        )
      },
      MemberExpression(path) {
        // A read of the program's stable numeric map (`SLOTS.THIS`) is its value; class
        // obfuscation and minify inline the same value.
        const node = original(path.node)
        if (
          node.computed ||
          t.isAssignmentExpression(path.parent, { left: path.node })
        )
          return
        const value = labelValue(context, declarations, node)
        if (value !== null && node.object.type === 'Identifier')
          path.replaceWith(t.numericLiteral(value))
      },
      Identifier(path) {
        // So is a read of a binding that stably holds a number (object extraction's spelling).
        if (
          !path.isReferencedIdentifier() ||
          t.isAssignmentExpression(path.parent, { left: path.node }) ||
          t.isUpdateExpression(path.parent)
        )
          return
        const value = labelValue(context, declarations, original(path.node))
        if (value !== null) path.replaceWith(t.numericLiteral(value))
      },
    })
    normalizeStatements(nodes)
    // An inlined decoy write stores only dummy literals into a named field; no handler of the
    // runtime does that, so it is dropped.
    const dummyOnly = (node) =>
      isDummyLiteral(node) ||
      (node?.type === 'ArrayExpression' && node.elements.every(dummyOnly))
    nodes.splice(
      0,
      nodes.length,
      ...nodes.filter(
        (statement) =>
          !(
            statement.type === 'ExpressionStatement' &&
            statement.expression.type === 'AssignmentExpression' &&
            statement.expression.operator === '=' &&
            statement.expression.left.type === 'MemberExpression' &&
            !statement.expression.left.computed &&
            dummyOnly(statement.expression.right)
          ),
      ),
    )
  }

  // A table handler is its own function, so it opens by reading the frame state a switch case
  // takes from the run function (`var regs = this._regs; var base = regs[this._f + 7]`): its
  // prologue, the leading statements whose writes propagation consumes. `body` is the rest, the
  // statements readers read; a case's body is all of its statements.
  for (const handler of handlers) {
    handler.prologue = handler.table
      ? tablePrologue(handler, lowerShape, context)
      : []
    handler.body = handler.statements.slice(handler.prologue.length)
  }

  // This decode's opcode values; canonical until behaviour matching overwrites them.
  const opcodes = createOpcodeTable()
  return {
    context,
    dispatch,
    handlers,
    opcodes,
    fields: { words: wordsField, pool: poolField },
    operand,
    constant,
    lower,
  }
}

// `T[label] = function () {...}` where T is the VM prototype or a stable alias of it.
function tableHandlers(context, declarations, vm) {
  const isPrototype = (node) =>
    node?.type === 'MemberExpression' &&
    !node.computed &&
    propertyName(node.property) === 'prototype' &&
    context.isReference(node.object, vm.binding)
  const aliases = new Set(
    declarations
      .filter(
        (item) =>
          item.kind === 'variable' &&
          isStableDeclaration(item) &&
          isPrototype(item.init),
      )
      .map((item) => item.binding),
  )
  const handlers = []
  for (const statement of context.program.body) {
    const node = statement.expression
    if (
      statement.type !== 'ExpressionStatement' ||
      node?.type !== 'AssignmentExpression' ||
      node.operator !== '=' ||
      node.left.type !== 'MemberExpression' ||
      !node.left.computed ||
      node.right.type !== 'FunctionExpression' ||
      !(
        isPrototype(node.left.object) ||
        aliases.has(context.bindingFor(node.left.object))
      )
    )
      continue
    const label = labelValue(context, declarations, node.left.property)
    if (label === null)
      decline('handler-locator', 'Dispatch label has no value')
    handlers.push({
      type: 'TableHandler',
      label,
      entry: node.right,
      statements: node.right.body.body,
      ends: true,
      table: true,
    })
  }
  if (handlers.length === 0)
    decline('handler-locator', 'Handler table has no handlers')
  return handlers
}

// Minify coalesces a table handler's locals: one variable holds the frame pointer and later the
// upvalue cell. On the handler's copy, each top-level write of a local starts a new version (SSA
// renaming), and a leading version holding a frame-state read is replaced by that read (copy
// propagation), so every handler spells its frame state the same way. A write nested in a loop or
// conditional starts no version: a loop-carried variable keeps one identity, and a version it can
// change before the local's next top-level write is not propagated. `origins` maps a kept
// identifier to its version, which matching binds like a binding.
function ssaPropagate(nodes, origins, context, fn) {
  const bindingOf = (node) => context.bindingFor(origins.get(node) ?? node)
  const local = (node) => {
    const binding = node?.type === 'Identifier' ? bindingOf(node) : null
    return binding && binding.scope.block === fn ? binding : null
  }
  // Frame state is read from the VM's own fields: a field (`this._regs`, `this._f`), or a field
  // indexed by fields and literals (the register base `this._regs[this._f + 7]`). A program
  // register is indexed from the register base, itself a read (`this._regs[base + 15]`).
  const fieldIndex = (node) =>
    node?.type === 'NumericLiteral' ||
    (node?.type === 'MemberExpression' &&
      !node.computed &&
      node.object.type === 'ThisExpression') ||
    (node?.type === 'BinaryExpression' &&
      node.operator === '+' &&
      fieldIndex(node.left) &&
      fieldIndex(node.right))
  const frameState = (node) =>
    node?.type === 'MemberExpression' &&
    (node.computed
      ? frameState(node.object) && fieldIndex(node.property)
      : node.object.type === 'ThisExpression')
  const copy = (node) => {
    const {
      nodes: [cloned],
      origins: map,
    } = cloneRuntimeFragment([node])
    const relink = (value, from) => {
      if (Array.isArray(value))
        return value.forEach((item, k) => relink(item, from[k]))
      if (!value || typeof value !== 'object' || !value.type) return
      const source = origins.get(from) ?? map.get(value)
      if (source) origins.set(value, source)
      for (const key of t.VISITOR_KEYS[value.type] ?? [])
        relink(value[key], from[key])
    }
    relink(cloned, node)
    return cloned
  }
  const versions = new Map()
  const values = new Map()
  const versionOf = (binding) => {
    if (!versions.has(binding))
      versions.set(binding, { ssa: binding, index: 0 })
    return versions.get(binding)
  }
  // Read occurrences in a statement take the current version, or its pure value.
  const rename = (root) =>
    traverse(t.file(t.program([root])), {
      noScope: true,
      Identifier(path) {
        if (
          path.parentPath.isMemberExpression({ property: path.node }) &&
          !path.parent.computed
        )
          return
        if (
          path.parentPath.isObjectProperty({ key: path.node }) &&
          !path.parent.computed
        )
          return
        const binding = local(path.node)
        if (!binding) return
        const version = versionOf(binding)
        if (values.has(version)) {
          path.replaceWith(copy(values.get(version)))
          path.skip()
        } else origins.set(path.node, version)
      },
    })
  // Per statement: the local its top-level write targets, and the locals it writes inside a nested
  // statement, where their value can change.
  const topTarget = (statement) =>
    statement.type === 'ExpressionStatement' &&
    statement.expression?.type === 'AssignmentExpression'
      ? statement.expression.left
      : null
  const nestedAt = nodes.map((statement) => {
    const top = topTarget(statement)
    const written = new Set()
    traverse(t.file(t.program([statement])), {
      noScope: true,
      'AssignmentExpression|UpdateExpression'(path) {
        const target = path.node.left ?? path.node.argument
        const binding = target !== top ? local(target) : null
        if (binding) written.add(binding)
      },
    })
    return written
  })
  // A version written at statement `index` keeps its value until the next top-level write of its
  // local, unless a nested write changes it first.
  const nestedWhileLive = (binding, index) => {
    for (let next = index + 1; next < nodes.length; next++) {
      if (nestedAt[next].has(binding)) return true
      if (local(topTarget(nodes[next])) === binding) return false
    }
    return false
  }
  const kept = []
  let prologue = true
  for (const [index, statement] of nodes.entries()) {
    const write = statement.expression
    const target =
      statement.type === 'ExpressionStatement' &&
      write?.type === 'AssignmentExpression' &&
      write.operator === '='
        ? local(write.left)
        : null
    if (!target) {
      prologue = false
      rename(statement)
      kept.push(statement)
      continue
    }
    const holder = t.expressionStatement(write.right)
    rename(holder)
    write.right = holder.expression
    const version = { ssa: target, index: versionOf(target).index + 1 }
    versions.set(target, version)
    // Only the leading frame-state reads propagate; a later one, a literal (a specialized
    // handler's baked operand) or a register read is the handler's own.
    if (
      prologue &&
      frameState(write.right) &&
      !nestedWhileLive(target, index)
    ) {
      values.set(version, write.right)
      continue
    }
    prologue = false
    origins.set(write.left, version)
    kept.push(statement)
  }
  nodes.splice(0, nodes.length, ...kept)
}

// A table handler's prologue: the statements before the one holding the first statement that
// propagation keeps. Each lowered statement is traced to the handler statement its nodes came from
// before propagation rewrites it.
function tablePrologue(handler, lowerShape, context) {
  const owner = new Map()
  const walk = (value, visit) => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, visit))
    if (!value || typeof value !== 'object' || !value.type) return
    if (visit(value)) return
    for (const key of t.VISITOR_KEYS[value.type] ?? []) walk(value[key], visit)
  }
  handler.statements.forEach((statement, index) =>
    walk(statement, (node) => void owner.set(node, index)),
  )
  const { nodes, origins } = cloneRuntimeFragment(handler.statements)
  lowerShape(nodes, origins)
  const from = new Map(
    nodes.map((statement) => {
      let index = null
      walk(statement, (node) => {
        if (index !== null) return true
        index = owner.get(origins.get(node)) ?? null
        return index !== null
      })
      return [statement, index]
    }),
  )
  ssaPropagate(nodes, origins, context, handler.entry)
  const first =
    nodes.length > 0 ? from.get(nodes[0]) : handler.statements.length
  return handler.statements.slice(0, first ?? 0)
}

// Each statement-level write stands alone: `var x = v, y = w` (not a loop head) and `x = v, y = w`
// read as `x = v; y = w;`. In place on `nodes`; also used for matcher templates.
export function normalizeStatements(nodes) {
  traverse(t.file(t.program([t.blockStatement(nodes)])), {
    noScope: true,
    // Brace spelling: a control body holding one simple statement is that statement
    // (normalize-source.js applies the same view).
    exit(path) {
      for (const key of ['consequent', 'alternate', 'body']) {
        const body = path.node[key]
        if (
          body &&
          !Array.isArray(body) &&
          isControlBodyKey(path.node.type, key) &&
          simpleControlBody(body) !== body
        )
          path.node[key] = simpleControlBody(body)
      }
    },
    VariableDeclaration(path) {
      if (path.node.kind !== 'var' || t.isFor(path.parent)) return
      path.replaceWithMultiple(
        path.node.declarations
          .filter((item) => item.init)
          .map((item) =>
            t.expressionStatement(
              t.assignmentExpression('=', item.id, item.init),
            ),
          ),
      )
    },
    // A loop head's leading initializers run once before the loop: `for (var a = x, i = 0; ...)`
    // reads as `a = x; for (var i = 0; ...)`, and likewise for a sequence.
    ForStatement(path) {
      const init = path.node.init
      const leading =
        init?.type === 'VariableDeclaration' && init.kind === 'var'
          ? init.declarations
              .slice(0, -1)
              .filter((item) => item.init)
              .map((item) => t.assignmentExpression('=', item.id, item.init))
          : init?.type === 'SequenceExpression'
            ? init.expressions.slice(0, -1)
            : []
      if (init?.type === 'VariableDeclaration' && leading.length > 0)
        init.declarations = init.declarations.slice(-1)
      else if (init?.type === 'SequenceExpression')
        path.node.init = init.expressions.at(-1)
      // `for (var x = v; ...)` reads as `for (x = v; ...)`: the var belongs to the function.
      const rest = path.node.init
      if (
        rest?.type === 'VariableDeclaration' &&
        rest.kind === 'var' &&
        rest.declarations.length === 1 &&
        rest.declarations[0].init
      ) {
        const [only] = rest.declarations
        path.node.init = t.assignmentExpression('=', only.id, only.init)
      }
      if (leading.length > 0)
        path.insertBefore(leading.map((item) => t.expressionStatement(item)))
    },
    ExpressionStatement(path) {
      if (path.node.expression.type !== 'SequenceExpression') return
      path.replaceWithMultiple(
        path.node.expression.expressions.map((item) =>
          t.expressionStatement(item),
        ),
      )
    },
  })
  return nodes
}

// Canonical handlers carry a value of this decode's opcode table; the rest are added opcodes.
export function partitionHandlers(view) {
  const nameByOpcode = new Map(
    Object.entries(view.opcodes).map(([name, value]) => [value, name]),
  )
  const canonical = []
  const extra = []
  for (const handler of view.handlers) {
    const name = nameByOpcode.get(handler.label)
    if (name) canonical.push({ name, opcode: handler.label, handler })
    else extra.push(handler)
  }
  extra.sort((left, right) => left.label - right.label)
  return { canonical, extra, firstAdded: Math.max(...nameByOpcode.keys()) + 1 }
}

// The view of the interpreter's handlers; a runtime the locator does not reach is not admitted.
export function requireHandlers(ast, code) {
  try {
    return locateHandlers(ast)
  } catch (error) {
    if (error instanceof ContainerDecline)
      decline(code, 'Numeric container is not admitted')
    throw error
  }
}

export function locateHandlers(ast) {
  return locate(ast)
}

export function diagnoseHandlers(ast) {
  try {
    const view = locate(ast)
    return deepFreeze({
      ok: true,
      result: { labels: view.handlers.map(({ label }) => label) },
      diagnostic: null,
    })
  } catch (error) {
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: error.code ?? 'handler-locator-error',
        message: error.message,
      },
    })
  }
}
