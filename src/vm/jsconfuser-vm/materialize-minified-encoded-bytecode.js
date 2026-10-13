import * as t from '@babel/types'
import {
  decline,
  makeContext,
  topLevelDeclarations,
} from './container-role-helpers.js'
import { decodeCanonicalBytecodeWords } from './materialize-encoded-bytecode.js'
import { minifiedRuntimeBodySignature } from './minified-runtime-body.js'

// The pinned minifier fuses the base64 decoder, u32 construction and root
// call into a top-level for loop followed by a call. The signature covers
// that complete runtime and loop, with only the payload bytes abstracted.
const ENCODED_RUNTIME_BODY_SHA256 =
  '0cda35e01a2c0c48f44acfdd92d721cbd15b4ecdb86744a76933c3af6179bced'

export function materializeMinifiedEncodedBytecode(input) {
  const ast = structuredClone(input)
  const context = makeContext(ast)
  const statements = context.program.body
  const loop = statements.at(-2)
  const boot = statements.at(-1)?.expression
  const entries = loop?.init?.declarations
  const vmCall = boot?.arguments?.[0]
  if (
    loop?.type !== 'ForStatement' ||
    loop.init.type !== 'VariableDeclaration' ||
    entries?.length !== 4 ||
    boot?.type !== 'CallExpression' ||
    boot.arguments.length !== 4 ||
    vmCall?.type !== 'NewExpression' ||
    vmCall.arguments.length !== 3 ||
    entries[0].init?.type !== 'Identifier' ||
    entries[1].init?.type !== 'CallExpression' ||
    entries[1].init.arguments.length !== 1 ||
    entries[1].init.arguments[0]?.type !== 'StringLiteral' ||
    entries[2].id?.type !== 'Identifier' ||
    boot.callee?.type !== 'Identifier' ||
    vmCall.arguments[0]?.type !== 'Identifier' ||
    !context.sameRef(boot.callee, context.bindingFor(entries[0].id)) ||
    !context.sameRef(vmCall.arguments[0], context.bindingFor(entries[2].id))
  ) {
    decline('minified-encoded-bytecode', 'Encoded minified boot is not unique')
  }
  const declarations = topLevelDeclarations(context)
  if (
    !declarations.some(
      (entry) =>
        entry.kind === 'function' &&
        context.sameRef(entries[0].init, entry.binding),
    ) ||
    !declarations.some(
      (entry) =>
        entry.kind === 'function' &&
        context.sameRef(entries[1].init.callee, entry.binding),
    )
  ) {
    decline('minified-encoded-bytecode', 'Runtime helper bindings changed')
  }
  const payload = entries[1].init.arguments[0]
  const encoded = payload.value
  payload.value = 'PAYLOAD'
  if (minifiedRuntimeBodySignature(ast, boot) !== ENCODED_RUNTIME_BODY_SHA256) {
    decline('minified-encoded-bytecode', 'Encoded runtime body changed')
  }
  const words = decodeCanonicalBytecodeWords(encoded)
  boot.callee = t.cloneNode(entries[0].init)
  vmCall.arguments[0] = t.arrayExpression(
    words.map((value) => t.numericLiteral(value)),
  )
  statements.splice(-2, 1)
  return ast
}
