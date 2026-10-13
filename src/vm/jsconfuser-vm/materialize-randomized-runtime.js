import * as t from '@babel/types'
import {
  EXPECTED_OPCODES,
  EXPECTED_SLOTS,
  decline,
  makeContext,
  numberValue,
  readPlainObject,
  topLevelDeclarations,
  vmShape,
  propertyName,
  isWordArray,
} from './container-role-helpers.js'
import { FIXED_WORD_WIDTHS } from './read-wordcode.js'
import { runtimeSignature } from './runtime-source-signature.js'

const NOISE_SLOTS = new Set([
  'NOISE_END',
  'NOISE_PARAMS',
  'NOISE_ARGS',
  'NOISE_PC',
  'NOISE_COUNTER',
  'NOISE_MIRROR',
  'NOISE_ACC',
])
const UINT32_MAX = 0xffffffff
// Complete pinned @NOISE guards from runtime.ts, excluding locations/comments.
// These are the only paths through which decoy slot values may affect the VM.
const NOISE_BRANCHES = new Set([
  '66fd6d043592ab6832169dc8f20edd97e63ec088232c5e8d26a9c38704c67dbd',
  '845f8027b1bc44e52398ff32e837eaad349c230457df6c9a28a2a9f5c03472ee',
  'c0147af1dd4bb2b16dd7817257088fc015182da06f85ce0fe2353dc8843a881f',
  'b050ca8427c5f1b5a3b5391100afd0e16396b4d804d52f78e2e8507f924045e0',
  'a95015b376d95db03caec72e0b45fb80809b2ec7a22d3976ef201e1cef8efdc0',
  'cbf6bfd1539890542f64b85ab0b440cb6213b57af43f269c4352f48b1aaa8be1',
  '4b74eeace2d6074fdc4391c3bed4f9bde6e505cbbb693dc00acfa6beef349d00',
  '3af8f3a5c663ce281d7427e067e9abc6629459e9a25c60ddc1b0d6360476a8b9',
  '2b88e16eefe9b197b50a57bf6b0c4d35c6d7f9b644a48970038a79d6955001c9',
])

function unique(declarations, role, predicate) {
  const found = declarations.filter(predicate)
  if (found.length !== 1 || !found[0].binding?.constant)
    decline('randomized-runtime', `${role} binding is not unique`)
  return found[0]
}

function hasKeys(entry, names, exact = true) {
  const keys = readPlainObject(entry.init)
  return (
    entry.kind === 'variable' &&
    keys &&
    (!exact || keys.size === names.length) &&
    names.every((name) => keys.has(name))
  )
}

function numericMap(node, names, role) {
  const entries = readPlainObject(node)
  if (
    !entries ||
    entries.size !== names.length ||
    names.some((name) => !entries.has(name))
  ) {
    decline('randomized-runtime', `${role} map is incomplete`)
  }
  const values = Object.fromEntries(
    [...entries].map(([name, value]) => [name, numberValue(value)]),
  )
  if (Object.values(values).some((value) => !Number.isSafeInteger(value))) {
    decline('randomized-runtime', `${role} map is not numeric`)
  }
  return values
}

export function projectWords(words, opcodes, sentinel) {
  const nameByValue = new Map(
    Object.entries(opcodes).map(([name, value]) => [value, name]),
  )
  const projected = words.slice()
  let pc = 0
  while (pc < words.length) {
    const name = nameByValue.get(words[pc])
    if (!name) decline('randomized-runtime', `Unknown opcode at ${pc}`)
    let width = FIXED_WORD_WIDTHS[name]
    if (['CALL', 'CALL_METHOD', 'NEW'].includes(name)) {
      const argcOffset = name === 'CALL_METHOD' ? 4 : 3
      const argc = words[pc + argcOffset]
      if (!Number.isSafeInteger(argc))
        decline('randomized-runtime', `Call width changed at ${pc}`)
      const spread = argc === sentinel
      width = argcOffset + 1 + (spread ? 1 : argc)
      if (spread) projected[pc + argcOffset] = 65535
    } else if (name === 'MAKE_CLOSURE') {
      width = 7 + 2 * words[pc + 5]
    } else if (name === 'BUILD_ARRAY') {
      width = 3 + words[pc + 2]
    } else if (name === 'BUILD_OBJECT') {
      width = 3 + 2 * words[pc + 2]
    }
    if (
      !Number.isSafeInteger(width) ||
      width < 1 ||
      pc + width > words.length
    ) {
      decline('randomized-runtime', `Instruction width changed at ${pc}`)
    }
    projected[pc] = EXPECTED_OPCODES[name]
    pc += width
  }
  return projected
}

export function materializeRandomizedRuntime(input) {
  const ast = t.cloneNode(input, true)
  const context = makeContext(ast)
  const declarations = topLevelDeclarations(context)
  const opcodeNames = Object.keys(EXPECTED_OPCODES)
  const op = unique(declarations, 'opcode map', (entry) =>
    hasKeys(entry, opcodeNames),
  )
  const slots = unique(declarations, 'frame slot map', (entry) =>
    hasKeys(entry, Object.keys(EXPECTED_SLOTS), false),
  )
  const sentinels = unique(declarations, 'spread sentinel', (entry) =>
    hasKeys(entry, ['CALL_SPREAD']),
  )
  const vm = unique(
    declarations,
    'VM constructor',
    (entry) => entry.kind === 'function' && vmShape(entry.init, context),
  )
  const shape = vmShape(vm.init, context)
  const frameStartBinding = context.bindingFor(shape.frameStart)
  const frameStart = unique(
    declarations,
    'frame start',
    (entry) => entry.binding === frameStartBinding,
  )
  const headers = context.nodes(context.program).filter(({ node }) => {
    const init = node.init
    const frame = context.bindingFor(init?.left)?.path.node.init
    return (
      node.type === 'VariableDeclarator' &&
      init?.type === 'BinaryExpression' &&
      init.operator === '+' &&
      init.right.type === 'Identifier' &&
      declarations.some(
        (entry) =>
          entry.kind === 'variable' &&
          entry.binding === context.bindingFor(init.right) &&
          numberValue(entry.init) !== null,
      ) &&
      frame?.type === 'MemberExpression' &&
      !frame.computed &&
      frame.object.type === 'ThisExpression' &&
      propertyName(frame.property) === '_regsTop'
    )
  })
  if (headers.length !== 1)
    decline('randomized-runtime', 'Frame header use is not unique')
  const headerBinding = context.bindingFor(headers[0].node.init.right)
  const header = unique(
    declarations,
    'frame header',
    (entry) => entry.binding === headerBinding,
  )
  const roots = context
    .nodes(context.program)
    .filter(
      ({ node, path }) =>
        node.type === 'NewExpression' &&
        !path.getFunctionParent() &&
        context.sameRef(node.callee, vm.binding),
    )
  if (roots.length !== 1) decline('randomized-runtime', 'VM boot is not unique')
  const payload = roots[0].node.arguments[0]?.arguments?.[0]
  const wordBinding = context.bindingFor(payload)
  const wordcode = unique(
    declarations,
    'word stream',
    (entry) => entry.binding === wordBinding && isWordArray(entry.init),
  )
  const opcodes = numericMap(op.init, opcodeNames, 'opcode')
  const opcodeValues = Object.values(opcodes)
  if (
    new Set(opcodeValues).size !== opcodeNames.length ||
    opcodeValues.some((value) => value < 0 || value > 65535)
  ) {
    decline('randomized-runtime', 'Opcode values are not distinct u16 words')
  }
  const spread = numericMap(
    sentinels.init,
    ['CALL_SPREAD'],
    'sentinel',
  ).CALL_SPREAD
  if (spread < 65535 || spread > UINT32_MAX) {
    decline('randomized-runtime', 'Spread sentinel is out of range')
  }
  const slotEntries = readPlainObject(slots.init)
  const required = Object.keys(EXPECTED_SLOTS)
  if (
    !slotEntries ||
    required.some((name) => !slotEntries.has(name)) ||
    [...slotEntries.keys()].some(
      (name) => !required.includes(name) && !NOISE_SLOTS.has(name),
    ) ||
    ![...slotEntries.keys()].some((name) => NOISE_SLOTS.has(name))
  ) {
    decline('randomized-runtime', 'Frame slots or noise fields changed')
  }
  const branches = context
    .nodes(context.program)
    .filter(
      ({ node }) =>
        node.type === 'IfStatement' &&
        NOISE_BRANCHES.has(runtimeSignature(node, context)),
    )
  if (
    branches.length !== NOISE_BRANCHES.size ||
    new Set(branches.map(({ node }) => runtimeSignature(node, context)))
      .size !== NOISE_BRANCHES.size
  ) {
    decline('randomized-runtime', 'Pinned noise guards are incomplete')
  }
  const noiseUses = context
    .nodes(context.program)
    .filter(
      ({ node }) =>
        node.type === 'MemberExpression' &&
        !node.computed &&
        context.sameRef(node.object, slots.binding) &&
        NOISE_SLOTS.has(node.property?.name),
    )
  if (
    noiseUses.some(
      ({ path }) =>
        !path.findParent(
          (parent) =>
            parent.isIfStatement() &&
            NOISE_BRANCHES.has(runtimeSignature(parent.node, context)),
        ),
    )
  ) {
    decline('randomized-runtime', 'Noise slot escapes its pinned guard')
  }
  const headerSize = numberValue(header.init)
  const frameStartValue = numberValue(frameStart.init)
  const slotValues = [...slotEntries.values()].map(numberValue)
  if (
    !Number.isSafeInteger(headerSize) ||
    headerSize < 8 ||
    headerSize > 16 ||
    !Number.isSafeInteger(frameStartValue) ||
    frameStartValue < 1 ||
    frameStartValue > 16 ||
    new Set(slotValues).size !== slotValues.length ||
    slotValues.some(
      (value) =>
        !Number.isSafeInteger(value) || value < 0 || value >= headerSize,
    )
  ) {
    decline('randomized-runtime', 'Frame layout is not a bounded permutation')
  }
  const elements =
    wordcode.init?.type === 'ArrayExpression' ? wordcode.init.elements : null
  const words = elements?.map(numberValue)
  if (
    !words?.length ||
    words.some(
      (value) =>
        !Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX,
    )
  ) {
    decline('randomized-runtime', 'Numeric word stream is absent')
  }
  const projected = projectWords(words, opcodes, spread)
  wordcode.node.init = t.arrayExpression(
    projected.map((value) => t.numericLiteral(value)),
  )
  for (const property of op.node.init.properties) {
    property.value = t.numericLiteral(EXPECTED_OPCODES[property.key.name])
  }
  sentinels.node.init.properties[0].value = t.numericLiteral(65535)
  slots.node.init.properties = slots.node.init.properties.filter((property) =>
    Object.hasOwn(EXPECTED_SLOTS, property.key.name),
  )
  for (const property of slots.node.init.properties) {
    property.value = t.numericLiteral(EXPECTED_SLOTS[property.key.name])
  }
  header.node.init = t.numericLiteral(8)
  frameStart.node.init = t.numericLiteral(1)
  context.programPath.scope.crawl()
  return ast
}
