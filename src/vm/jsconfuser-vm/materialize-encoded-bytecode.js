import * as t from '@babel/types'
import {
  decline,
  makeContext,
  referenceCount,
  topLevelDeclarations,
} from './container-role-helpers.js'
import { BASE64_SHA256, runtimeSignature } from './runtime-source-signature.js'

// The pinned decoder has two emitted forms: an ENCODE_BYTECODE binding and the
// class pass's inlined true literal. The hashes cover the complete parameter
// list and body, excluding source locations and comments.
const DECODER_SIGNATURES = new Map([
  [
    '5e639974414e47e7fb566a6ae57cd56b9a6329a776218898b5976f91d01cb19c',
    'binding',
  ],
  [
    '9b59983b3f00d85cb0830cf870e168002e10a12ec82082f2e096b26dca9dd186',
    'inlined',
  ],
])

function unique(items, role) {
  if (items.length !== 1) decline('encoded-bytecode', `${role} is not unique`)
  return items[0]
}

export function decodeCanonicalBytecodeWords(value) {
  if (
    typeof value !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    decline('encoded-bytecode', 'Payload is not canonical base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (
    bytes.length === 0 ||
    bytes.length % 4 !== 0 ||
    bytes.toString('base64') !== value
  ) {
    decline('encoded-bytecode', 'Payload is not a u32 LE byte stream')
  }
  return Array.from({ length: bytes.length / 4 }, (_, index) =>
    bytes.readUInt32LE(index * 4),
  )
}

export function materializeEncodedBytecode(input) {
  const ast = t.cloneNode(input, true)
  const context = makeContext(ast)
  const declarations = topLevelDeclarations(context)
  const decoder = unique(
    declarations.filter(
      (entry) =>
        entry.kind === 'function' &&
        DECODER_SIGNATURES.has(
          runtimeSignature(
            {
              params: entry.init.params,
              body: entry.init.body,
            },
            context,
          ),
        ),
    ),
    'pinned bytecode decoder',
  )
  const form = DECODER_SIGNATURES.get(
    runtimeSignature(
      {
        params: decoder.init.params,
        body: decoder.init.body,
      },
      context,
    ),
  )
  const helper = unique(
    declarations.filter(
      (entry) =>
        entry.kind === 'function' &&
        runtimeSignature(entry.init, context) === BASE64_SHA256 &&
        entry.binding?.constant,
    ),
    'pinned base64 helper',
  )
  const helperCalls = context
    .nodes(decoder.init)
    .filter(
      ({ node }) =>
        node.type === 'CallExpression' &&
        context.sameRef(node.callee, helper.binding) &&
        node.arguments.length === 1 &&
        context.sameRef(
          node.arguments[0],
          context.bindingFor(decoder.init.params[0]),
        ),
    )
  if (helperCalls.length !== 1) {
    decline('encoded-bytecode', 'Decoder does not call the pinned helper')
  }
  const calls = context
    .nodes(context.program)
    .filter(
      ({ node }) =>
        node.type === 'CallExpression' &&
        context.sameRef(node.callee, decoder.binding),
    )
  const call = unique(calls, 'bytecode decode call').node
  if (
    call.arguments.length !== 1 ||
    referenceCount(context, decoder.binding) !== 1
  ) {
    decline('encoded-bytecode', 'Bytecode decoder call changed')
  }
  const payload = call.arguments[0]
  let encoded
  let wordsBinding = null
  if (payload.type === 'Identifier') {
    wordsBinding = context.bindingFor(payload)
    const declaration = declarations.filter(
      (entry) => entry.binding === wordsBinding && entry.kind === 'variable',
    )
    const words = unique(declaration, 'encoded payload binding')
    if (
      words.init?.type !== 'StringLiteral' ||
      referenceCount(context, wordsBinding) !== 1
    ) {
      decline('encoded-bytecode', 'Encoded payload binding changed')
    }
    encoded = words.init.value
  } else if (payload.type === 'StringLiteral' && form === 'inlined') {
    encoded = payload.value
  } else {
    decline('encoded-bytecode', 'Encoded payload is not connected')
  }
  const words = decodeCanonicalBytecodeWords(encoded)
  const array = t.arrayExpression(words.map((value) => t.numericLiteral(value)))
  if (wordsBinding) {
    wordsBinding.path.node.init = array
  } else {
    let name = '__decodedBytecode'
    while (context.programPath.scope.hasBinding(name)) name += '_'
    context.program.body.unshift(
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(name), array),
      ]),
    )
    call.arguments[0] = t.identifier(name)
  }
  const condition = decoder.init.body.body[0]?.test?.argument
  if (form === 'binding') {
    const binding = context.bindingFor(condition)
    const scalar = declarations.filter(
      (entry) => entry.binding === binding && entry.kind === 'variable',
    )
    const mode = unique(scalar, 'bytecode mode binding')
    if (
      mode.init?.type !== 'BooleanLiteral' ||
      mode.init.value !== true ||
      referenceCount(context, binding) !== 1
    ) {
      decline('encoded-bytecode', 'Bytecode mode changed')
    }
    mode.node.init = t.booleanLiteral(false)
  } else if (condition?.type === 'BooleanLiteral' && condition.value === true) {
    decoder.init.body.body[0].test.argument = t.booleanLiteral(false)
  } else {
    decline('encoded-bytecode', 'Inlined bytecode mode changed')
  }
  context.programPath.scope.crawl()
  return ast
}
