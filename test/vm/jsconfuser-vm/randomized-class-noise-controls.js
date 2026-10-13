import fs from 'node:fs'
import assert from 'node:assert/strict'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { materializeRandomizedMinifiedClass } from '../../../src/vm/jsconfuser-vm/materialize-randomized-minified-class.js'

export function noiseSource(seed) {
  return fs.readFileSync(
    new URL(
      `fixtures/randomized-class/arithmetic-minified-${seed}.js`,
      import.meta.url,
    ),
    'utf8',
  )
}

function sourceRoles(ast, layout) {
  let dispatch, start
  traverse(ast, {
    SwitchStatement(p) {
      dispatch = p
    },
  })
  const run = dispatch.getFunctionParent()
  traverse(ast, {
    AssignmentExpression(p) {
      if (
        p.node.left.property?.right?.value === layout.slots.PC &&
        t.isMemberExpression(p.node.right) &&
        !p.node.right.computed &&
        p.getFunctionParent() !== run
      )
        start = p
    },
  })
  assert(start)
  const frame = start.getFunctionParent()
  const regs = start.node.left.object,
    fp = start.node.left.property.left
  let size, end, top, params, args, fetch
  frame.traverse({
    AssignmentExpression(p) {
      if (p.node.left.property?.right?.value === layout.slots.FRAME_SIZE)
        size = p.node.right
    },
    BinaryExpression(p) {
      if (
        p.node.operator === '-' &&
        p.node.right.value === 1 &&
        t.isMemberExpression(p.node.left)
      )
        params = p.node.left
    },
    CallExpression(p) {
      if (p.node.callee.property?.name === 'slice') args = p.node.callee.object
    },
  })
  frame.traverse({
    VariableDeclarator(p) {
      if (
        p.node.init?.operator === '+' &&
        p.node.init.left.name === fp.name &&
        p.node.init.right.name === size.name
      )
        end = p.node.id
    },
  })
  frame.traverse({
    AssignmentExpression(p) {
      if (
        t.isMemberExpression(p.node.left) &&
        !p.node.left.computed &&
        p.node.right.name === end.name
      )
        top = p
    },
  })
  run.traverse({
    VariableDeclarator(p) {
      if (
        p.node.id.name === dispatch.node.discriminant.name &&
        t.isMemberExpression(p.node.init) &&
        p.node.init.computed &&
        t.isMemberExpression(p.node.init.object)
      )
        fetch = p
    },
    AssignmentExpression(p) {
      if (
        p.node.left.name === dispatch.node.discriminant.name &&
        t.isMemberExpression(p.node.right) &&
        p.node.right.computed &&
        t.isMemberExpression(p.node.right.object)
      )
        fetch = p
    },
  })
  assert(size && end && top && params && args && fetch)
  return {
    dispatch,
    run,
    frame,
    start,
    regs,
    fp,
    size,
    end,
    top,
    params,
    args,
    fetch,
  }
}

// Synthetic contract control: expand the retained seed191 header and insert all
// source-defined optional roles. This is not a fresh encoder/native population.
export function completeNoiseAst() {
  const ast = parse(noiseSource(191))
  const layout = materializeRandomizedMinifiedClass(ast).layout
  const r = sourceRoles(ast, layout),
    clone = (n) => t.cloneNode(n, true)
  r.frame.traverse({
    BinaryExpression(p) {
      if (p.node.operator !== '+') return
      if (
        p.node.left.value === layout.headerSize &&
        t.isMemberExpression(p.node.right)
      )
        p.node.left.value = 15
      if (
        p.node.left.name === r.fp.name &&
        p.node.right.value === layout.headerSize
      )
        p.node.right.value = 15
    },
  })
  const free = Array.from({ length: 15 }, (_, i) => i).filter(
    (i) =>
      !Object.values(layout.slots).includes(i) &&
      !layout.noise.some((n) => n.offset === i),
  )
  const offsets = Object.fromEntries(
    ['END', 'PARAMS', 'ARGS', 'PC', 'COUNTER', 'MIRROR'].map((name, i) => [
      name,
      free[i],
    ]),
  )
  assert.equal(new Set(Object.values(offsets)).size, 6)
  const slot = (regs, fp, offset) =>
    t.memberExpression(
      clone(regs),
      t.binaryExpression('+', clone(fp), t.numericLiteral(offset)),
      true,
    )
  const assign = (left, right) =>
    t.expressionStatement(t.assignmentExpression('=', left, clone(right)))
  r.top.parentPath.insertBefore(
    ['END', 'PARAMS', 'ARGS', 'PC', 'COUNTER'].map((role) =>
      assign(
        slot(r.regs, r.fp, offsets[role]),
        {
          END: r.end,
          PARAMS: r.params,
          ARGS: r.args,
          PC: r.start.node.right,
          COUNTER: t.numericLiteral(0),
        }[role],
      ),
    ),
  )
  const acc = layout.noise.find((n) => n.role === 'ACC'),
    fetch = r.fetch.node.init ?? r.fetch.node.right
  let churn
  r.run.traverse({
    AssignmentExpression(p) {
      if (
        p.node.left.property?.right?.value === acc.offset &&
        !p.findParent((q) => q.isTryStatement())
      )
        churn = p
    },
  })
  assert(churn?.parentPath.isExpressionStatement())
  const dispatchSlot = (role) =>
    slot(churn.node.left.object, churn.node.left.property.left, offsets[role])
  churn.parentPath.insertBefore([
    assign(
      dispatchSlot('PC'),
      t.binaryExpression(
        '%',
        t.binaryExpression('+', dispatchSlot('PC'), t.numericLiteral(1)),
        t.memberExpression(clone(fetch.object), t.identifier('length')),
      ),
    ),
    t.expressionStatement(
      t.updateExpression('++', dispatchSlot('COUNTER'), false),
    ),
    assign(dispatchSlot('MIRROR'), r.dispatch.node.discriminant),
  ])
  assert.equal(materializeRandomizedMinifiedClass(ast).layout.noise.length, 9)
  return ast
}

export function noiseEffect(ast, role, phase) {
  const layout = materializeRandomizedMinifiedClass(ast).layout
  const noise = layout.noise.find((n) => n.role === role && n.phase === phase)
  assert(noise, `${role}/${phase} must be emitted by this control`)
  const r = sourceRoles(ast, layout),
    owner = phase === 'push' ? r.frame : r.run
  let effect
  owner.traverse({
    'AssignmentExpression|UpdateExpression'(p) {
      if (
        (p.node.left ?? p.node.argument).property?.right?.value ===
          noise.offset &&
        !p.findParent((q) => q.isTryStatement())
      )
        effect = p
    },
  })
  assert(effect)
  return { effect, layout, roles: r }
}

export function mutateNoise(ast, role, phase, mutation) {
  const { effect, roles } = noiseEffect(ast, role, phase)
  if (mutation === 'foreign-word-array') {
    assert.equal(role, 'PC')
    const length = effect.node.right.right
    assert(t.isMemberExpression(length) && length.property.name === 'length')
    length.object = t.memberExpression(
      t.identifier('globalThis'),
      t.identifier('foreignWords'),
    )
  } else if (mutation === 'foreign-descriptor') {
    assert(phase === 'push' && ['PC', 'PARAMS'].includes(role))
    effect.node.right.object = t.memberExpression(
      t.identifier('globalThis'),
      t.identifier('foreignDescriptor'),
    )
  } else if (mutation === 'foreign-cursor') {
    assert.equal(role, 'ACC')
    effect.node.right.left.right = t.identifier('foreignCursor')
  } else if (mutation === 'foreign-read') {
    const offset = (effect.node.left ?? effect.node.argument).property.right
      .value
    let read
    effect.get('right').traverse({
      MemberExpression(p) {
        if (p.node.computed && p.node.property?.right?.value === offset)
          read = p
      },
    })
    assert(read)
    const alias = effect.scope.getBinding(read.node.object.name)
    let field
    roles.run.traverse({
      'VariableDeclarator|AssignmentExpression'(p) {
        if (
          p.scope.getBinding((p.node.id ?? p.node.left).name) === alias &&
          t.isMemberExpression(p.node.init ?? p.node.right)
        )
          field = (p.node.init ?? p.node.right).property
      },
    })
    assert(field)
    read.node.object = t.memberExpression(
      t.identifier('globalThis'),
      t.cloneNode(field),
    )
  } else if (mutation === 'compound') {
    if (effect.isUpdateExpression())
      effect.replaceWith(
        t.assignmentExpression(
          '+=',
          t.cloneNode(effect.node.argument, true),
          t.numericLiteral(1),
        ),
      )
    else effect.node.operator = '+='
  } else if (mutation === 'conditional') {
    const value = t.cloneNode(effect.node, true)
    assert(effect.parentPath.isExpressionStatement())
    effect.parentPath.replaceWith(
      t.ifStatement(
        t.identifier('noiseCondition'),
        t.expressionStatement(value),
      ),
    )
  } else if (mutation === 'value') {
    effect.replaceWith(
      t.callExpression(t.identifier('noiseConsumer'), [
        t.cloneNode(effect.node, true),
      ]),
    )
  } else if (mutation === 'after-phase') {
    const value = t.cloneNode(effect.node, true)
    assert(effect.parentPath.isExpressionStatement())
    effect.parentPath.remove()
    if (phase === 'push')
      roles.top.parentPath.insertAfter(t.expressionStatement(value))
    else
      roles.dispatch
        .findParent((p) => p.isTryStatement())
        .insertAfter(t.expressionStatement(value))
  } else if (mutation === 'logical') {
    effect.replaceWith(
      t.logicalExpression(
        '&&',
        t.identifier('noiseCondition'),
        t.cloneNode(effect.node, true),
      ),
    )
  } else if (mutation === 'conditional-value') {
    effect.replaceWith(
      t.conditionalExpression(
        t.identifier('noiseCondition'),
        t.cloneNode(effect.node, true),
        t.numericLiteral(0),
      ),
    )
  } else if (mutation === 'returned') {
    assert(effect.parentPath.isExpressionStatement())
    effect.parentPath.replaceWith(
      t.returnStatement(t.cloneNode(effect.node, true)),
    )
  } else if (mutation === 'before-phase') {
    const value = t.cloneNode(effect.node, true)
    assert(effect.parentPath.isExpressionStatement())
    effect.parentPath.remove()
    const anchor = (phase === 'push' ? roles.start : roles.fetch).findParent(
      (p) => p.isExpressionStatement() || p.isVariableDeclaration(),
    )
    anchor.insertBefore(t.expressionStatement(value))
  } else if (mutation === 'foreign-frame') {
    ;(effect.node.left ?? effect.node.argument).property.left =
      t.identifier('foreignFrame')
  } else if (mutation === 'foreign-write') {
    ;(effect.node.left ?? effect.node.argument).object =
      t.identifier('foreignRegisters')
  } else if (mutation === 'prefix') {
    assert(effect.isUpdateExpression())
    effect.node.prefix = true
  } else if (mutation === 'decrement') {
    assert(effect.isUpdateExpression())
    effect.node.operator = '--'
  } else if (mutation === 'interposed-effect') {
    effect.parentPath.insertBefore(
      t.expressionStatement(t.callExpression(t.identifier('observed'), [])),
    )
  } else if (['alias-receiver', 'alias-compound'].includes(mutation)) {
    // The register alias the effect writes through, defined in its phase.
    const registers = (effect.node.left ?? effect.node.argument).object
    let definition
    ;(phase === 'push' ? roles.frame : roles.run).traverse({
      'VariableDeclarator|AssignmentExpression'(p) {
        if (
          (p.node.id ?? p.node.left).name === registers.name &&
          t.isMemberExpression(p.node.init ?? p.node.right)
        )
          definition = p
      },
    })
    assert(definition)
    if (mutation === 'alias-receiver')
      (definition.node.init ?? definition.node.right).object =
        t.identifier('otherVM')
    else if (definition.isAssignmentExpression())
      definition.node.operator = '+='
    else {
      const { id, init } = definition.node
      definition.node.init = t.assignmentExpression(
        '+=',
        t.cloneNode(id),
        t.cloneNode(init),
      )
    }
  } else throw new Error(`Unknown noise mutation: ${mutation}`)
  return generate(ast).code
}
