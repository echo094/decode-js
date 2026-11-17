import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { firstReal } from './handler-calls.js'
import { ssaPropagate } from './handler-table.js'
import { normalizeStatements } from './normalize-handler-statements.js'
import { isDummyLiteral, labelValue } from './runtime-callables.js'
import { cloneRuntimeFragment } from './runtime-fragment-pattern.js'

// An inlined decoy write stores only dummy literals into a named field; no handler of the runtime
// does that, so it is dropped. In place on `nodes`.
function dropDecoyWrites(nodes) {
  const dummyOnly = (node) =>
    isDummyLiteral(node) ||
    (node?.type === 'ArrayExpression' && node.elements.every(dummyOnly))
  const decoyWrite = ({ type, expression }) =>
    type === 'ExpressionStatement' &&
    expression.type === 'AssignmentExpression' &&
    expression.operator === '=' &&
    expression.left.type === 'MemberExpression' &&
    !expression.left.computed &&
    dummyOnly(expression.right)
  nodes.splice(0, nodes.length, ...nodes.filter((item) => !decoyWrite(item)))
}

/**
 * Handler statements lowered for comparison, over the runtime's calls (`calls`, a `HandlerCalls`)
 * and its located readers (`readers`: `operandReader`, `constantReader` and the constant reader's
 * `defaulted` parameter indexes): reader calls become `$operand()` and `$constant(...)` with their
 * explicit arguments, other calls lose decoy arguments, reads of stable numbers are their values,
 * and each statement-level write stands alone.
 */
export class HandlerLowering {
  constructor(calls, readers, declarations) {
    this.calls = calls
    this.context = calls.context
    this.declarations = declarations
    this.operandReader = readers.operandReader
    this.constantReader = readers.constantReader
    this.defaulted = readers.defaulted
  }

  // A table handler's statements cloned and lowered, with each clone's original: what its prologue
  // is read from.
  loweredClone(handler) {
    const { nodes, origins } = cloneRuntimeFragment(handler.statements)
    this.lowerShape(nodes, origins)
    return { nodes, origins }
  }

  readerArguments(node, reader) {
    if (this.calls.calleeOf(node) !== reader) return null
    const args = this.calls.realArguments(node, reader)
    if (reader.kind === 'function' && !this.calls.isState(args[0])) return null
    return args.slice(firstReal(reader))
  }

  operand(node) {
    return this.readerArguments(node, this.operandReader)?.length === 0
  }

  // Explicit constant arguments in the reader's (index, key) order; a call passing none gives [].
  constant(node) {
    const reader = this.constantReader
    if (this.calls.calleeOf(node) !== reader) return null
    if (node.arguments.length === firstReal(reader)) {
      if (reader.kind === 'function' && !this.calls.isState(node.arguments[0]))
        return null
      return []
    }
    const args = this.calls.realArguments(node, reader)
    if (reader.kind === 'function' && !this.calls.isState(node.arguments[0]))
      return null
    const kept = reader.bindings
      .map((_, index) => index)
      .filter((index) => !reader.decoys.has(index))
    if (args.length > kept.length) return null
    return this.defaulted.map((index) => args[kept.indexOf(index)])
  }

  // Lower cloned handler statements for comparison: reader calls become `$operand()` and
  // `$constant(...)` with their explicit arguments, other calls lose decoy arguments, and each
  // statement-level write stands alone (`var x = v, y = w` and `x = v, y = w` read as `x = v;
  // y = w`). `origins` maps clones to the runtime's own nodes. `nodes` clone some of a handler's
  // `body`; for a table handler its prologue is cloned in front, and propagation consumes it.
  lower(nodes, origins, handler = null) {
    if (handler?.table && handler.prologue.length > 0)
      nodes.unshift(...cloneRuntimeFragment(handler.prologue, origins).nodes)
    this.lowerShape(nodes, origins)
    if (handler?.table)
      ssaPropagate(nodes, origins, this.context, handler.entry)
    return nodes
  }

  lowerShape(nodes, origins) {
    const original = (node) => origins?.get(node) ?? node
    // A File root gives every statement a parent path; the block keeps `nodes` as its body.
    traverse(
      t.file(t.program([t.blockStatement(nodes)])),
      this.loweringVisitor(original),
    )
    normalizeStatements(nodes)
    dropDecoyWrites(nodes)
  }

  // The lowering's visitor; `original` maps a clone to the runtime's own node.
  loweringVisitor(original) {
    // The visitor's own `this` is Babel's state, so the lowering is named.
    const lowering = this
    const { calls, context, declarations } = this
    return {
      noScope: true,
      CallExpression(path) {
        const node = original(path.node)
        const callable = calls.calleeOf(node) ?? calls.methodOf(node)
        if (!callable) return
        const position = (argument) => node.arguments.indexOf(argument)
        const cloned = (argument) => path.node.arguments[position(argument)]
        if (callable === lowering.operandReader && lowering.operand(node)) {
          path.replaceWith(t.callExpression(t.identifier('$operand'), []))
          path.skip()
          return
        }
        const args =
          callable === lowering.constantReader ? lowering.constant(node) : null
        if (args) {
          path.node.callee = t.identifier('$constant')
          path.node.arguments = args.map(cloned)
          return
        }
        path.node.arguments = calls.realArguments(node, callable).map(cloned)
      },
      NewExpression(path) {
        const node = original(path.node)
        const binding =
          node.callee.type === 'Identifier'
            ? context.bindingFor(node.callee)
            : null
        const callable = calls.callables.find(
          (item) =>
            item.kind === 'function' && binding && item.binding === binding,
        )
        if (!callable) return
        const position = (argument) => node.arguments.indexOf(argument)
        path.node.arguments = calls
          .realArguments(node, callable)
          .map((argument) => path.node.arguments[position(argument)])
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
    }
  }
}
