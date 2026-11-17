import * as t from '@babel/types'
import {
  decline,
  refused,
  makeContext,
  propertyName,
  prototypeMethods,
  topLevelDeclarations,
} from '../source/container-role-helpers.js'
import { firstReal, HandlerCalls } from './handler-calls.js'
import { HandlerLowering } from './handler-lowering.js'
import { tableHandlers, tablePrologue } from './handler-table.js'
import { locateBootSkeleton } from '../source/locate-boot-payload.js'
import { createOpcodeTable } from '../source/opcode-table.js'
import {
  callableLayout,
  caseStatements,
  functionFor,
  functionOf,
  labelValue,
  storedFields,
} from './runtime-callables.js'

// The handler locator finds the interpreter by what it does, never by names: the boot call enters
// the run loop with the VM its construction filled from the payload; the loop fetches the word at
// the frame's PC from the VM's word field and dispatches on it. Operand and constant readers are
// the functions whose bodies read that field and the pool field. Class obfuscation, minify
// devirtualization and case shuffle re-spell these pieces and keep the behaviour.

// The binding and value a declarator or a plain `=` assignment writes, or null.
function writtenValue(node) {
  if (node.type === 'VariableDeclarator')
    return { id: node.id, value: node.init }
  if (node.type === 'AssignmentExpression' && node.operator === '=')
    return { id: node.left, value: node.right }
  return null
}

/**
 * Locates the interpreter's handlers from the boot skeleton, one recognition step per method in the
 * order `locate` runs them; each step declines when its shape is not unique. Calls are read through
 * `HandlerCalls` once the entry is located, and handlers lowered through `HandlerLowering` once both
 * readers are.
 */
class HandlerLocator {
  constructor(ast) {
    this.context = makeContext(ast)
    this.declarations = topLevelDeclarations(this.context)
    const { call, holder, wordsIndex, poolIndex } = locateBootSkeleton(ast)
    this.call = call
    this.holder = holder
    this.vm = functionFor(this.context, this.declarations, holder.callee)
    const vmFunction = this.vm && functionOf(this.vm)
    if (!vmFunction) decline('handler-locator', 'VM construction is not unique')
    const fields = storedFields(this.context, vmFunction)
    this.wordsField = fields.get(wordsIndex)
    this.poolField = fields.get(poolIndex)
    if (!this.wordsField || !this.poolField)
      decline('handler-locator', 'VM payload fields are not stored')
    this.stateBinding = null
  }

  // Field names some code reads: a member access other than a plain write's target.
  readFields() {
    return new Set(
      this.context
        .nodes(this.context.program)
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
  }

  // Every method (by unique name) and top-level function with its decoy layout.
  collectCallables() {
    const { context, declarations } = this
    const owners = declarations.filter(
      (item) =>
        item.kind === 'function' && prototypeMethods(context, item).length > 0,
    )
    const methodCounts = new Map()
    for (const owner of owners)
      for (const { name } of prototypeMethods(context, owner))
        methodCounts.set(name, (methodCounts.get(name) ?? 0) + 1)
    const readFields = this.readFields()
    this.callables = []
    for (const owner of owners)
      for (const { name, fn } of prototypeMethods(context, owner)) {
        if (methodCounts.get(name) !== 1) continue
        const layout = callableLayout(context, fn, null, readFields)
        if (layout)
          this.callables.push({ kind: 'method', name, fn, owner, ...layout })
      }
    for (const item of declarations) {
      const fn = item.kind === 'function' ? functionOf(item) : null
      if (!fn) continue
      const self = fn.params[0]
      // A devirtualized method writes through its first parameter; a constructor through `this`.
      const selfBinding =
        self?.type === 'Identifier' ? context.bindingFor(self) : null
      const layout = callableLayout(context, fn, selfBinding, readFields)
      if (layout)
        this.callables.push({
          kind: 'function',
          binding: item.binding,
          fn,
          ...layout,
        })
    }
  }

  // The run entry and how its body refers to the VM: `this` in a method, a parameter otherwise.
  locateEntry() {
    const { context, declarations, call, holder } = this
    if (call.callee.type === 'MemberExpression' && !call.callee.computed) {
      const methods = prototypeMethods(context, this.vm).filter(
        (item) => item.name === propertyName(call.callee.property),
      )
      if (methods.length !== 1)
        decline('handler-locator', 'VM run method is not unique')
      this.entry = methods[0].fn
      return
    }
    const run = functionFor(context, declarations, call.callee)
    const entry = run && functionOf(run)
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
    this.entry = entry
    this.stateBinding = context.bindingFor(entry.params[index])
  }

  // The call queries over the callables, once the entry fixes how the VM state is referred to.
  readCalls() {
    this.calls = new HandlerCalls(
      this.context,
      this.callables,
      this.stateBinding,
    )
  }

  // The fetch: a local of the run entry initialized by reading the word field at an index.
  selectors() {
    const selectors = new Set()
    for (const { node, path } of this.context.nodes(this.entry)) {
      const read = writtenValue(node)
      if (
        read?.value?.type === 'MemberExpression' &&
        read.value.computed &&
        this.calls.isField(read.value.object, this.wordsField, (object) =>
          this.calls.isState(object),
        ) &&
        path.getFunctionParent()?.node === this.entry
      ) {
        const binding = this.context.bindingFor(read.id)
        if (binding) selectors.add(binding)
      }
    }
    return selectors
  }

  // The dispatch on the fetched word: a switch on it, or a handler table call by it, the state's
  // member named by the fetched word.
  locateDispatch() {
    const { context } = this
    const selectors = [...this.selectors()]
    const fetched = (node) =>
      selectors.some((binding) => context.isReference(node, binding))
    const switches = context
      .nodes(this.entry)
      .filter(
        ({ node }) =>
          node.type === 'SwitchStatement' && fetched(node.discriminant),
      )
    const tableCalls = context
      .nodes(this.entry)
      .filter(
        ({ node }) =>
          node.type === 'CallExpression' &&
          node.callee.type === 'MemberExpression' &&
          node.callee.computed &&
          this.calls.isState(node.callee.object) &&
          fetched(node.callee.property),
      )
    if (switches.length + tableCalls.length !== 1)
      decline('handler-locator', 'Dispatch on the fetched word is not unique')
    this.dispatch = (switches[0] ?? tableCalls[0]).node
  }

  // Operand reader: returns the word at a post-incremented index.
  locateOperandReader() {
    const operands = this.callables.filter((callable) => {
      const body = this.calls.effectiveBody(callable)
      const value = body.length === 1 ? body[0].argument : null
      return (
        body[0]?.type === 'ReturnStatement' &&
        value?.type === 'MemberExpression' &&
        value.computed &&
        value.property.type === 'UpdateExpression' &&
        value.property.operator === '++' &&
        !value.property.prefix &&
        this.calls.isField(
          value.object,
          this.wordsField,
          this.calls.selfOf(callable),
        )
      )
    })
    if (operands.length !== 1)
      decline('handler-locator', 'Operand reader is not unique')
    this.operandReader = operands[0]
  }

  // Constant reader: reads the pool field; its two operand parameters default to operand reads on
  // its own receiver (`C(a)`, `a.z(7)` in a devirtualized function, `this.Q()` in a method).
  locateConstantReader() {
    const { context } = this
    const constants = this.callables.filter(
      (callable) =>
        callable !== this.operandReader &&
        context
          .nodes(callable.fn)
          .some(({ node }) =>
            this.calls.isField(
              node,
              this.poolField,
              this.calls.selfOf(callable),
            ),
          ),
    )
    if (constants.length !== 1)
      decline('handler-locator', 'Constant reader is not unique')
    const reader = constants[0]
    this.constantReader = reader
    const readsOperand = (node) =>
      this.calls.calleeOf(node) === this.operandReader ||
      (this.calls.methodOf(node) === this.operandReader &&
        this.calls.selfOf(reader)(node.callee.object))
    const defaulted = context.nodes(reader.fn).flatMap(({ node }) => {
      const value = writtenValue(node)?.value
      if (
        value?.type !== 'LogicalExpression' ||
        value.operator !== '??' ||
        !readsOperand(value.right)
      )
        return []
      const index = reader.bindings.indexOf(context.bindingFor(value.left))
      return index >= 0 ? [index] : []
    })
    const real = reader.bindings
      .map((_, index) => index)
      .filter(
        (index) => !reader.decoys.has(index) && index >= firstReal(reader),
      )
    // Minify drops the pair when no handler passes it; the reader then reads both operands itself.
    if (
      ![0, 2].includes(defaulted.length) ||
      new Set(defaulted).size !== defaulted.length ||
      defaulted.some((index) => !real.includes(index))
    )
      decline('handler-locator', 'Constant reader parameters are ambiguous')
    this.defaulted = defaulted
  }

  // The lowering, once both readers are located.
  prepareLowering() {
    this.lowering = new HandlerLowering(
      this.calls,
      {
        operandReader: this.operandReader,
        constantReader: this.constantReader,
        defaulted: this.defaulted,
      },
      this.declarations,
    )
  }

  collectHandlers() {
    const { context, declarations, dispatch } = this
    const handlers = (
      dispatch.type === 'SwitchStatement'
        ? dispatch.cases
        : tableHandlers(context, declarations, this.vm)
    ).flatMap((item) => {
      if (item.type === 'TableHandler') return [item]
      if (!item.test) return []
      const label = labelValue(context, declarations, item.test)
      if (label === null)
        decline('handler-locator', 'Dispatch label has no value')
      const statements = caseStatements(item)
      // A case leaves the dispatch by `break`, by a final `throw`, or by ending the switch as its
      // last case.
      const ends =
        statements.at(-1)?.type === 'BreakStatement' ||
        statements.at(-1)?.type === 'ThrowStatement' ||
        (item === dispatch.cases.at(-1) && !statements.some(t.isBreakStatement))
      return [{ label, entry: item, statements, ends, table: false }]
    })
    if (new Set(handlers.map(({ label }) => label)).size !== handlers.length)
      decline('handler-locator', 'Dispatch labels are not distinct')
    // A table handler is its own function, so it opens by reading the frame state a switch case
    // takes from the run function (`var regs = this._regs; var base = regs[this._f + 7]`): its
    // prologue, the leading statements whose writes propagation consumes. `body` is the rest, the
    // statements readers read; a case's body is all of its statements.
    for (const handler of handlers) {
      handler.prologue = handler.table
        ? tablePrologue(handler, this.lowering.loweredClone(handler), context)
        : []
      handler.body = handler.statements.slice(handler.prologue.length)
    }
    this.handlers = handlers
  }
}

// The handler view: the dispatch, its handlers and the readers' lowering, located in order.
function locate(ast) {
  const locator = new HandlerLocator(ast)
  locator.collectCallables()
  locator.locateEntry()
  locator.readCalls()
  locator.locateDispatch()
  locator.locateOperandReader()
  locator.locateConstantReader()
  locator.prepareLowering()
  locator.collectHandlers()
  const { lowering } = locator
  return {
    context: locator.context,
    dispatch: locator.dispatch,
    handlers: locator.handlers,
    // This decode's opcode values; canonical until behaviour matching overwrites them.
    opcodes: createOpcodeTable(),
    fields: { words: locator.wordsField, pool: locator.poolField },
    operand: (node) => lowering.operand(node),
    constant: (node) => lowering.constant(node),
    lower: (nodes, origins, handler) => lowering.lower(nodes, origins, handler),
  }
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
    // A refusal of the locator's own is this caller's; anything else passes on.
    refused(error)
    return decline(code, 'Numeric container is not admitted')
  }
}

export function locateHandlers(ast) {
  return locate(ast)
}
