import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { CLASS_RUNTIME_SOURCE } from './class-runtime-source.js'
import {
  EXPECTED_OPCODES,
  EXPECTED_SLOTS,
  makeContext,
  propertyName,
} from './container-role-helpers.js'

// Keep the semantic provenance of each inlined value; equal numeric constants
// in unrelated operations are never layout holes.
const ast = parse(CLASS_RUNTIME_SOURCE)
const symbolic = makeContext(ast)
export const layoutRoles = new WeakMap()
const scalars = {
  HEADER_SIZE: 8,
  FRAME_START: 1,
  MAIN_START_PC: 0,
  MAIN_REG_COUNT: 0,
  ENCODE_BYTECODE: false,
  TIMING_CHECKS: false,
}
for (const { node, path } of symbolic.nodes(symbolic.program)) {
  let role, value
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.object.type === 'Identifier' &&
    !symbolic.bindingFor(node.object)
  ) {
    const group = node.object.name
    const name = propertyName(node.property)
    if (group === 'OP') value = EXPECTED_OPCODES[name]
    else if (group === 'SLOTS') value = EXPECTED_SLOTS[name]
    else if (group === 'SENTINELS') value = 65535
    else continue
    role = `${group}.${name}`
  } else if (
    node.type === 'Identifier' &&
    path.isReferencedIdentifier() &&
    !symbolic.bindingFor(node) &&
    Object.hasOwn(scalars, node.name)
  ) {
    value = scalars[node.name]
    if (['HEADER_SIZE', 'FRAME_START'].includes(node.name)) role = node.name
  } else continue
  const replacement =
    value === undefined
      ? t.unaryExpression('void', t.numericLiteral(0))
      : typeof value === 'boolean'
        ? t.booleanLiteral(value)
        : t.numericLiteral(value)
  if (role) layoutRoles.set(replacement, role)
  path.replaceWith(replacement)
}
export const classTemplate = makeContext(ast)
