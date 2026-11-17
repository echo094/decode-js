import * as t from '@babel/types'
import { decline } from '../model/model.js'
import {
  bareGlobal,
  expressionProducer,
  literalNode,
  registerName,
} from '../model/operations.js'

// Renders one typed operation as Babel nodes: expressions, calls, object literals, closure
// captures and the statements an instruction writes.

const name = (text) => t.identifier(text)
const assign = (left, right) =>
  t.expressionStatement(t.assignmentExpression('=', left, right))
const member = (object, property) => t.memberExpression(object, property, true)
const globalMember = (key) => member(name('globalThis'), literalNode(key))
const continueDispatch = () => t.continueStatement(name('__recovered_dispatch'))
const setPc = (value) => assign(name('__recovered_pc'), value)
const pcNode = (pc) => t.numericLiteral(pc)

// A literal's property name: an identifier or string key as written, any other key computed.
function propertyKey(part, register, source) {
  if (part.literalReads?.has(register)) {
    const value = part.literalReads.get(register)
    if (typeof value === 'string')
      return {
        key: /^[A-Za-z_$][\w$]*$/.test(value)
          ? name(value)
          : t.stringLiteral(value),
        computed: false,
      }
  }
  return { key: source(register), computed: true }
}

// A unit's literal: its parts in the order they ran, a getter or setter as the closure folded
// into it. Written at its site, or in its use when the site is folded.
function objectLiteralExpression(frame, instruction) {
  const { parts } = instruction.unit
  const properties = []
  for (const part of parts) {
    const source = operandSource(frame, part)
    const operation = part.operation
    const property = (register, value) => {
      const { key, computed } = propertyKey(part, register, source)
      return t.objectProperty(key, value, computed)
    }
    if (operation.kind === 'object')
      for (const { key, value } of operation.pairs)
        properties.push(property(key, source(value)))
    else if (operation.kind === 'property-write')
      properties.push(property(operation.key, source(operation.value)))
    else if (operation.kind === 'accessor') {
      const closure = valueExpression(
        frame,
        part.foldedReads.get(operation.callback),
      )
      const { key, computed } = propertyKey(part, operation.key, source)
      properties.push(
        t.objectMethod(
          operation.accessor,
          key,
          closure.params,
          closure.body,
          computed,
        ),
      )
    } else properties.push(t.spreadElement(source(operation.source)))
  }
  return t.objectExpression(properties)
}

// The register a capture index names in `frame`.
function captureName(frame, index) {
  const captured = frame.captures[index]
  if (captured === undefined)
    decline(
      'invalid-capture-pair',
      `Capture ${index} is outside function ${frame.functionId}'s captures`,
    )
  return captured
}

// The registers a closure site hands its function as captures: a local capture is this
// function's register, an inherited one the register this function's own capture names.
export function closureCaptures(frame, operation) {
  return operation.captures.map((capture) => {
    if (!capture || !Number.isSafeInteger(capture.index) || capture.index < 0)
      decline(
        'invalid-capture-pair',
        'Closure contains an invalid capture pair',
      )
    if (capture.kind === 'local')
      return registerName(frame.functionId, capture.index)
    if (capture.kind === 'upvalue') return captureName(frame, capture.index)
    return decline(
      'unsupported-capture-kind',
      'Closure has an unknown capture kind',
    )
  })
}

// A call's argument list: the compiler's array spread, or its registers.
function argumentList(source, { kind, registers }) {
  return kind === 'array-register'
    ? [t.spreadElement(source(registers[0]))]
    : registers.map(source)
}

// A call whose callee is folded as a read of its receiver register, `o[k]` called with `o`, is
// written as the method call `o[k](args)`: the receiver is that read's object.
function callExpression(frame, instruction, source, operation) {
  const calleeRead = instruction.foldedReads?.get(operation.callee)
  if (
    operation.mode === 'apply' &&
    operation.receiver.kind === 'register' &&
    calleeRead?.operation.kind === 'property-read' &&
    calleeRead.operation.object === operation.receiver.index
  )
    return t.callExpression(
      valueExpression(frame, calleeRead),
      argumentList(source, operation.arguments),
    )
  const callee = source(operation.callee)
  // `new C(args)` is `Reflect.construct(C, args)` for every callee; a spread iterates the
  // compiler's own array, as a plain call's does.
  if (operation.mode === 'construct')
    return t.newExpression(callee, argumentList(source, operation.arguments))
  if (operation.receiver.kind === 'none')
    return t.callExpression(callee, argumentList(source, operation.arguments))
  // The callee is evaluated before the receiver and the arguments, as `foldSlots` orders them.
  const { kind, registers } = operation.arguments
  const args =
    kind === 'array-register'
      ? source(registers[0])
      : t.arrayExpression(registers.map(source))
  return t.callExpression(t.memberExpression(name('Reflect'), name('apply')), [
    callee,
    source(operation.receiver.index),
    args,
  ])
}

// The operand renderer of one instruction: a literal read as its literal, a folded read as its
// producer's expression, any other read as the register.
function operandSource(frame, instruction) {
  return (register) => {
    if (instruction.literalReads?.has(register))
      return literalNode(instruction.literalReads.get(register))
    const producer = instruction.foldedReads?.get(register)
    if (producer) return valueExpression(frame, producer)
    return name(registerName(frame.functionId, register))
  }
}

// An assignment's value as an expression, by value kind.
const ASSIGNED_VALUES = Object.freeze({
  literal: (value) => literalNode(value.value),
  this: () => t.thisExpression(),
  register: (value, source) => source(value.index),
  binary: (value, source) =>
    t.binaryExpression(value.operator, source(value.left), source(value.right)),
  unary: (value, source) =>
    t.unaryExpression(value.operator, source(value.source)),
  typeof: (value, source) => t.unaryExpression('typeof', source(value.source)),
  undefined: () => literalNode(undefined),
})

function assignedValue(value, source) {
  if (!Object.hasOwn(ASSIGNED_VALUES, value.kind))
    decline('unsupported-switch-value', `Unknown VM switch value ${value.kind}`)
  return ASSIGNED_VALUES[value.kind](value, source)
}

// The value a foldable producer or a bare global read writes, as one expression
// (expressionProducer), or a unit's literal. `this` is the function's own, as in the sloppy source.
export function valueExpression(frame, instruction) {
  if (instruction.unit) return objectLiteralExpression(frame, instruction)
  const operation = instruction.operation
  const source = operandSource(frame, instruction)
  switch (operation.kind) {
    case 'assign':
      return assignedValue(operation.value, source)
    case 'upvalue-read':
      return name(captureName(frame, operation.index))
    case 'closure':
      if (!frame.closures.has(instruction.pc))
        throw new Error(`Closure site ${instruction.pc} was not written first`)
      return t.cloneNode(frame.closures.get(instruction.pc))
    case 'property-read':
      return member(source(operation.object), source(operation.key))
    case 'property-delete':
      return t.unaryExpression(
        'delete',
        member(source(operation.object), source(operation.key)),
      )
    case 'global-read':
      return name(operation.name)
    // Native `typeof name`, which also sees an inherited global (the handler's own-property test
    // does not); a bare `typeof eval` is no direct eval, so only `arguments` and the decode's own
    // names read the global object.
    case 'safe-typeof':
      return t.unaryExpression(
        'typeof',
        operation.name === 'arguments' ||
          operation.name.startsWith('__recovered_')
          ? globalMember(operation.name)
          : name(operation.name),
      )
    case 'call':
      return callExpression(frame, instruction, source, operation)
    // A conditional value is written by the structured walk, which owns its arms, before the case
    // reading it.
    case 'conditional-value':
      if (!frame.conditionalValues.has(instruction.pc))
        throw new Error(
          `Conditional value ${instruction.pc} was not written first`,
        )
      return t.cloneNode(frame.conditionalValues.get(instruction.pc))
    case 'array':
      return t.arrayExpression(operation.elements.map(source))
    default:
      return decline(
        'unsupported-switch-operation',
        `VM switch emission does not fold ${operation.kind}`,
      )
  }
}

// A global read keeping its checked form: the reference check, then the read.
function checkedGlobalRead(global) {
  return {
    check: t.ifStatement(
      t.unaryExpression(
        '!',
        t.binaryExpression('in', literalNode(global), name('globalThis')),
      ),
      t.throwStatement(
        t.newExpression(name('ReferenceError'), [
          t.binaryExpression(
            '+',
            literalNode(global),
            t.stringLiteral(' is not defined'),
          ),
        ]),
      ),
    ),
    read: globalMember(global),
  }
}

// The dispatch rendering's control transfers: each sets the next PC, or leaves the function.
const TRANSFERS = Object.freeze({
  jump: ({ operation }) => [
    setPc(pcNode(operation.target)),
    continueDispatch(),
  ],
  branch: ({ operation, source, nextPc }) => {
    const condition = source(operation.condition)
    const predicate =
      operation.when === 'false' ? t.unaryExpression('!', condition) : condition
    return [
      setPc(
        t.conditionalExpression(
          predicate,
          pcNode(operation.target),
          pcNode(nextPc),
        ),
      ),
      continueDispatch(),
    ]
  },
  'indirect-jump': ({ operation, source }) => [
    setPc(source(operation.source)),
    continueDispatch(),
  ],
  return: ({ operation, source }) => [
    t.returnStatement(source(operation.source)),
  ],
  throw: ({ operation, source }) => [
    t.throwStatement(source(operation.source)),
  ],
  'for-in-next': ({ operation, source, destination, nextPc }) => {
    const iterator = () => source(operation.iterator)
    const field = (key) => t.memberExpression(iterator(), name(key))
    return [
      t.ifStatement(
        t.binaryExpression(
          '>=',
          field('index'),
          t.memberExpression(field('keys'), name('length')),
        ),
        t.blockStatement([setPc(pcNode(operation.exit))]),
        t.blockStatement([
          assign(
            destination(),
            member(field('keys'), t.updateExpression('++', field('index'))),
          ),
          setPc(pcNode(nextPc)),
        ]),
      ),
      continueDispatch(),
    ]
  },
})

// An accessor definition keeps the other accessor an existing property has.
function accessorStatement({ frame, instruction, operation, source }) {
  const { functionId } = frame
  const object = () => source(operation.object)
  const key = () => source(operation.key)
  const descriptor = () =>
    name(`__recovered_descriptor_${functionId}_${instruction.pc}`)
  const existing = () =>
    name(`__recovered_existing_${functionId}_${instruction.pc}`)
  const accessor = operation.accessor
  const other = accessor === 'get' ? 'set' : 'get'
  const otherOf = (object) => t.memberExpression(object, name(other))
  const objectMethod = (method) =>
    t.memberExpression(name('Object'), name(method))
  return [
    t.blockStatement([
      t.variableDeclaration('const', [
        t.variableDeclarator(
          existing(),
          t.callExpression(objectMethod('getOwnPropertyDescriptor'), [
            object(),
            key(),
          ]),
        ),
      ]),
      t.variableDeclaration('const', [
        t.variableDeclarator(
          descriptor(),
          t.objectExpression([
            t.objectProperty(name(accessor), source(operation.callback)),
            t.objectProperty(name('configurable'), t.booleanLiteral(true)),
            t.objectProperty(name('enumerable'), t.booleanLiteral(true)),
          ]),
        ),
      ]),
      t.ifStatement(
        t.logicalExpression(
          '&&',
          existing(),
          t.binaryExpression(
            '===',
            t.unaryExpression('typeof', otherOf(existing())),
            t.stringLiteral('function'),
          ),
        ),
        assign(otherOf(descriptor()), otherOf(existing())),
      ),
      t.expressionStatement(
        t.callExpression(objectMethod('defineProperty'), [
          object(),
          key(),
          descriptor(),
        ]),
      ),
    ]),
  ]
}

// A handler record pushed on the dispatch rendering's handler stack.
function pushHandler(fields) {
  return t.expressionStatement(
    t.callExpression(
      t.memberExpression(name('__recovered_handlers'), name('push')),
      [
        t.objectExpression(
          Object.entries(fields).map(([key, value]) =>
            t.objectProperty(name(key), value),
          ),
        ),
      ],
    ),
  )
}

// The statements of operations that go on to the next case.
const EFFECTS = Object.freeze({
  'global-read': ({ operation, destination }) => {
    const { check, read } = checkedGlobalRead(operation.name)
    return [check, assign(destination(), read)]
  },
  'global-write': ({ operation, source }) => [
    assign(globalMember(operation.name), source(operation.source)),
  ],
  'upvalue-write': ({ frame, operation, source }) => [
    assign(name(captureName(frame, operation.index)), source(operation.source)),
  ],
  'property-write': ({ operation, source }) => [
    assign(
      member(source(operation.object), source(operation.key)),
      source(operation.value),
    ),
  ],
  object: ({ operation, source, destination }) => [
    assign(destination(), t.objectExpression([])),
    ...operation.pairs.map((pair) =>
      assign(member(destination(), source(pair.key)), source(pair.value)),
    ),
  ],
  accessor: accessorStatement,
  'for-in-setup': ({ operation, source, destination }) => [
    assign(
      destination(),
      t.objectExpression([
        t.objectProperty(
          name('keys'),
          t.callExpression(name('__recovered_enumerable_keys'), [
            source(operation.source),
          ]),
        ),
        t.objectProperty(name('index'), t.numericLiteral(0)),
      ]),
    ),
  ],
  'catch-setup': ({ operation }) => [
    pushHandler({
      kind: t.stringLiteral('catch'),
      target: pcNode(operation.target),
      register: t.numericLiteral(operation.exceptionRegister),
    }),
  ],
  'handler-pop': () => [
    t.expressionStatement(
      t.callExpression(
        t.memberExpression(name('__recovered_handlers'), name('pop')),
        [],
      ),
    ),
  ],
  'finally-setup': ({ operation }) => [
    pushHandler({
      kind: t.stringLiteral('finally'),
      target: pcNode(operation.target),
      continuation: t.numericLiteral(operation.continuation),
      payload: t.numericLiteral(operation.payload),
      throwPad: pcNode(operation.throwPad),
    }),
  ],
})

// An unread definition that may throw keeps its evaluation, without the register write.
function discardedStatements(frame, instruction) {
  const { operation } = instruction
  if (operation.kind === 'global-read' && !bareGlobal(operation.name)) {
    const { check, read } = checkedGlobalRead(operation.name)
    return [check, t.expressionStatement(read)]
  }
  return [t.expressionStatement(valueExpression(frame, instruction))]
}

// The statements one instruction writes; in the dispatch rendering, an operation that goes on
// sets the next PC.
export function emitInstruction(frame, instruction, emissionMode = 'dispatch') {
  const operation = instruction.operation
  if (!operation)
    decline(
      'missing-switch-operation',
      'VM switch case has no semantic operation',
    )
  const nextPc = instruction.nextPc
  const next =
    emissionMode === 'dispatch'
      ? [setPc(pcNode(nextPc)), continueDispatch()]
      : []
  const destination = () =>
    name(registerName(frame.functionId, operation.destination))
  if (instruction.unit)
    return [
      assign(
        name(registerName(frame.functionId, instruction.unit.destination)),
        objectLiteralExpression(frame, instruction),
      ),
      ...next,
    ]
  if (instruction.discarded)
    return [...discardedStatements(frame, instruction), ...next]
  const step = {
    frame,
    instruction,
    operation,
    nextPc,
    source: operandSource(frame, instruction),
    destination,
  }
  if (expressionProducer(operation))
    return [assign(destination(), valueExpression(frame, instruction)), ...next]
  const { kind } = operation
  if (Object.hasOwn(TRANSFERS, kind)) return TRANSFERS[kind](step)
  if (Object.hasOwn(EFFECTS, kind)) return [...EFFECTS[kind](step), ...next]
  if (kind === 'debugger') return next
  decline(
    'unsupported-switch-operation',
    `VM switch emission does not support ${kind}`,
  )
}

// The dispatch rendering's write of a handler record's register field: one case per register.
export function emitHandlerRegisterAssignment(
  functionId,
  registerCount,
  property,
  value,
) {
  const cases = Array.from({ length: registerCount }, (_, register) =>
    t.switchCase(t.numericLiteral(register), [
      assign(name(registerName(functionId, register)), t.cloneNode(value)),
      t.breakStatement(),
    ]),
  )
  cases.push(
    t.switchCase(null, [
      t.throwStatement(
        t.newExpression(name('Error'), [
          t.stringLiteral('Invalid recovered handler register'),
        ]),
      ),
    ]),
  )
  return t.switchStatement(
    t.memberExpression(name('__recovered_handler'), name(property)),
    cases,
  )
}
