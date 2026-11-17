import traverse from '@babel/traverse'
import * as t from '@babel/types'
import {
  decline,
  isStableDeclaration,
  propertyName,
} from '../source/container-role-helpers.js'
import { labelValue } from './runtime-callables.js'
import { cloneRuntimeFragment } from './runtime-fragment-pattern.js'

// A handler table's handlers: each `T[label] = function () {...}` handler, the prologue that reads
// the frame state a switch case would take from the run function, and the propagation that
// consumes it.

// `T[label] = function () {...}` where T is the VM prototype or a stable alias of it.
export function tableHandlers(context, declarations, vm) {
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
// Frame state is read from the VM's own fields: a field (`this._regs`, `this._f`), or a field
// indexed by fields and literals (the register base `this._regs[this._f + 7]`). A program
// register is indexed from the register base, itself a read (`this._regs[base + 15]`).
function fieldIndex(node) {
  return (
    node?.type === 'NumericLiteral' ||
    (node?.type === 'MemberExpression' &&
      !node.computed &&
      node.object.type === 'ThisExpression') ||
    (node?.type === 'BinaryExpression' &&
      node.operator === '+' &&
      fieldIndex(node.left) &&
      fieldIndex(node.right))
  )
}

function frameState(node) {
  return (
    node?.type === 'MemberExpression' &&
    (node.computed
      ? frameState(node.object) && fieldIndex(node.property)
      : node.object.type === 'ThisExpression')
  )
}

// The target of a statement's top-level write.
function topTarget(statement) {
  return statement.type === 'ExpressionStatement' &&
    statement.expression?.type === 'AssignmentExpression'
    ? statement.expression.left
    : null
}

// One propagation over a handler copy's statements (`nodes`, of function `fn`).
class SsaPropagation {
  constructor(nodes, origins, context, fn) {
    Object.assign(this, { nodes, origins, context, fn })
    this.versions = new Map()
    this.values = new Map()
  }

  // A binding local to the handler function.
  local(node) {
    const binding =
      node?.type === 'Identifier'
        ? this.context.bindingFor(this.origins.get(node) ?? node)
        : null
    return binding && binding.scope.block === this.fn ? binding : null
  }

  // A fresh copy of a propagated value, each copied node mapped to its original.
  copy(node) {
    const { origins } = this
    const {
      nodes: [cloned],
      origins: map,
    } = cloneRuntimeFragment([node])
    // A copy's original is its node's original when propagation copied that node too.
    t.traverseFast(cloned, (copied) => {
      const from = map.get(copied)
      origins.set(copied, origins.get(from) ?? from)
    })
    return cloned
  }

  versionOf(binding) {
    if (!this.versions.has(binding))
      this.versions.set(binding, { ssa: binding, index: 0 })
    return this.versions.get(binding)
  }

  // Read occurrences in a statement take the current version, or its pure value.
  rename(root) {
    // The visitor's own `this` is Babel's state, so the propagation is named.
    const propagation = this
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
        const binding = propagation.local(path.node)
        if (!binding) return
        const version = propagation.versionOf(binding)
        if (propagation.values.has(version)) {
          path.replaceWith(propagation.copy(propagation.values.get(version)))
          path.skip()
        } else propagation.origins.set(path.node, version)
      },
    })
  }

  // Per statement, the locals it writes inside a nested statement, where their value can change.
  nestedWrites() {
    return this.nodes.map((statement) => {
      const top = topTarget(statement)
      const written = new Set()
      traverse(t.file(t.program([statement])), {
        noScope: true,
        'AssignmentExpression|UpdateExpression': (path) => {
          const target = path.node.left ?? path.node.argument
          const binding = target !== top ? this.local(target) : null
          if (binding) written.add(binding)
        },
      })
      return written
    })
  }

  // A version written at statement `index` keeps its value until the next top-level write of its
  // local, unless a nested write changes it first.
  nestedWhileLive(binding, index) {
    const { nodes } = this
    for (let next = index + 1; next < nodes.length; next++) {
      if (this.nestedAt[next].has(binding)) return true
      if (this.local(topTarget(nodes[next])) === binding) return false
    }
    return false
  }

  run() {
    this.nestedAt = this.nestedWrites()
    const kept = []
    let prologue = true
    for (const [index, statement] of this.nodes.entries()) {
      const write = statement.expression
      const target =
        statement.type === 'ExpressionStatement' &&
        write?.type === 'AssignmentExpression' &&
        write.operator === '='
          ? this.local(write.left)
          : null
      if (!target) {
        prologue = false
        this.rename(statement)
        kept.push(statement)
        continue
      }
      const holder = t.expressionStatement(write.right)
      this.rename(holder)
      write.right = holder.expression
      const version = { ssa: target, index: this.versionOf(target).index + 1 }
      this.versions.set(target, version)
      // Only the leading frame-state reads propagate; a later one, a literal (a specialized
      // handler's baked operand) or a register read is the handler's own.
      if (
        prologue &&
        frameState(write.right) &&
        !this.nestedWhileLive(target, index)
      ) {
        this.values.set(version, write.right)
        continue
      }
      prologue = false
      this.origins.set(write.left, version)
      kept.push(statement)
    }
    this.nodes.splice(0, this.nodes.length, ...kept)
  }
}

export function ssaPropagate(nodes, origins, context, fn) {
  new SsaPropagation(nodes, origins, context, fn).run()
}

// A table handler's prologue: the statements before the one holding the first statement that
// propagation keeps, read from the handler's statements cloned and lowered by the locator (`nodes`,
// with each clone's original in `origins`). Each lowered statement is traced to the handler statement
// its nodes came from before propagation rewrites it.
export function tablePrologue(handler, { nodes, origins }, context) {
  const owner = new Map()
  handler.statements.forEach((statement, index) =>
    t.traverseFast(statement, (node) => void owner.set(node, index)),
  )
  // A lowered statement comes from the handler statement owning its first node with an original.
  const from = new Map(
    nodes.map((statement) => {
      let index = null
      t.traverseFast(statement, (node) => {
        index = owner.get(origins.get(node)) ?? null
        return index === null ? undefined : t.traverseFast.stop
      })
      return [statement, index]
    }),
  )
  ssaPropagate(nodes, origins, context, handler.entry)
  const first =
    nodes.length > 0 ? from.get(nodes[0]) : handler.statements.length
  return handler.statements.slice(0, first ?? 0)
}
