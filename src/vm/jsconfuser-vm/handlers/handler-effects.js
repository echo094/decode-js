import { cloneRuntimeFragment } from './runtime-fragment-pattern.js'

// What a handler does, independent of how a runtime layer spelled it. The lowered handler is
// evaluated symbolically: each operand read becomes a slot numbered in read order (`{op: k}`; a
// constant read without explicit arguments reads two), a literal stays a value, and a local is a
// carrier of its value, so whether minify kept or folded it changes nothing. A statement-level
// `a || b`, `a && b` or `c ? x : y` is the `if` it stands for. The result is the list of effects:
// writes to anything but a local, calls, conditionals, loops, throws and returns.

// A handler's statements without its closing break and empty statements.
export function withoutBreaks(statements) {
  return statements.filter(
    (statement) =>
      statement.type !== 'BreakStatement' &&
      statement.type !== 'EmptyStatement',
  )
}

export function handlerEffects(view, handler, identities = new Map()) {
  const statements = withoutBreaks(handler.body)
  const { nodes, origins } = cloneRuntimeFragment(statements)
  view.lower(nodes, origins, handler)
  // A binding outside the handler (the run function's state, a helper) is one identity across the
  // runtime; a local version read before any write is numbered within the handler; an unbound
  // name is the global it names.
  const locals = new Map()
  const keyOf = (node) => {
    const origin = origins.get(node)
    if (origin?.ssa) return origin
    return view.context.bindingFor(origin ?? node) ?? `global:${node.name}`
  }
  const read = (node) => {
    const key = keyOf(node)
    if (typeof key === 'string') return { global: key.slice('global:'.length) }
    if (key?.ssa) {
      if (!locals.has(key)) locals.set(key, locals.size)
      return { local: locals.get(key) }
    }
    if (!identities.has(key)) identities.set(key, identities.size)
    return { free: identities.get(key) }
  }
  return evaluateEffects(nodes, {
    keyOf,
    read,
    unbound: (node) => !view.context.bindingFor(origins.get(node) ?? node),
  })
}

// The effects of a catalogue template (handler-matchers.js), already in lowered form: a `$name`
// placeholder is the role it names (`{role}`), any other name the global it names.
export function templateEffects(nodes) {
  return evaluateEffects(nodes, {
    keyOf: (node) => node.name,
    read: (node) =>
      node.name.startsWith('$')
        ? { role: node.name.slice(1) }
        : { global: node.name },
    unbound: (node) => !node.name.startsWith('$'),
  })
}

function evaluateEffects(nodes, callbacks) {
  return new EffectEvaluator(callbacks).run(nodes)
}

// Bitwise chains associate on int32 values, so a regrouped chain is one list of operands.
const ASSOCIATIVE = new Set(['^', '&', '|'])

// A compound assignment (`x &= y`) and a written-out chain build the same term.
function binary(operator, left, right) {
  if (!ASSOCIATIVE.has(operator)) return { operator, left, right }
  const parts = (term) =>
    term?.operator === operator && Array.isArray(term.operands)
      ? term.operands
      : [term]
  return { operator, operands: [...parts(left), ...parts(right)] }
}

const expressionStatement = (expression) => ({
  type: 'ExpressionStatement',
  expression,
})

function asIf(test, consequent, alternate = null) {
  return {
    type: 'IfStatement',
    test,
    consequent: expressionStatement(consequent),
    alternate: alternate && expressionStatement(alternate),
  }
}

// A statement-level `a || b`, `a && b` or `c ? x : y` is the `if` it stands for, and a sequence is
// its statements; any other expression has no statement form (null).
function statementForm(expression) {
  if (expression.type === 'LogicalExpression' && expression.operator !== '??')
    return [
      asIf(
        expression.operator === '||'
          ? {
              type: 'UnaryExpression',
              operator: '!',
              argument: expression.left,
            }
          : expression.left,
        expression.right,
      ),
    ]
  if (expression.type === 'ConditionalExpression')
    return [asIf(expression.test, expression.consequent, expression.alternate)]
  if (expression.type === 'SequenceExpression')
    return expression.expressions.map(expressionStatement)
  return null
}

// A local written inside a conditional or loop holds, after it, what the paths leave: the one
// value when every path agrees, otherwise the join of the paths' values.
function join(env, kind, test, branches) {
  const keys = new Set(branches.flatMap((branch) => [...branch.keys()]))
  for (const key of keys) {
    const values = branches.map((branch) =>
      branch.has(key) ? branch.get(key) : (env.get(key) ?? { unset: true }),
    )
    const before = env.has(key) ? JSON.stringify(env.get(key)) : null
    if (values.every((item) => JSON.stringify(item) === before)) continue
    env.set(
      key,
      values.every((item) => JSON.stringify(item) === JSON.stringify(values[0]))
        ? values[0]
        : { join: kind, test, values },
    )
  }
}

const literal = (evaluator, node) => ({ literal: node.value })
// Minify's spellings of constants: `void 0` is undefined, `!0` and `!1` are booleans.
const LITERAL_TYPES = ['NumericLiteral', 'BooleanLiteral', 'StringLiteral']

// One rule per expression type: (evaluator, node, env) -> term.
const VALUE_RULES = Object.freeze({
  CallExpression: (evaluator, node, env) => {
    const name = node.callee.type === 'Identifier' ? node.callee.name : null
    if (name === '$operand') return { op: evaluator.slots++ }
    if (name === '$constant')
      return node.arguments.length === 0
        ? { constant: [{ op: evaluator.slots++ }, { op: evaluator.slots++ }] }
        : { constant: node.arguments.map((item) => evaluator.value(item, env)) }
    const callee = evaluator.value(node.callee, env)
    const args = node.arguments.map((item) => evaluator.value(item, env))
    // `Array(n)` constructs as `new Array(n)` does.
    if (callee?.global === 'Array') return { new: callee, args }
    return { call: callee, args }
  },
  NewExpression: (evaluator, node, env) => ({
    new: evaluator.value(node.callee, env),
    args: node.arguments.map((item) => evaluator.value(item, env)),
  }),
  NumericLiteral: literal,
  StringLiteral: literal,
  BooleanLiteral: literal,
  NullLiteral: () => ({ literal: null }),
  ThisExpression: () => ({ this: true }),
  Identifier: (evaluator, node, env) => {
    if (node.name === 'undefined' && evaluator.unbound(node))
      return { undefined: true }
    const key = evaluator.keyOf(node)
    return env.has(key) ? env.get(key) : evaluator.read(node)
  },
  MemberExpression: (evaluator, node, env) => {
    const object = evaluator.value(node.object, env)
    const property = node.computed
      ? evaluator.value(node.property, env)
      : { name: node.property.name }
    // An operand array indexed by a literal is that element: an alias reads its permuted
    // operands this way.
    if (object?.array && Number.isInteger(property?.literal))
      return object.array[property.literal] ?? { undefined: true }
    return { get: [object, property] }
  },
  ArrayExpression: (evaluator, node, env) => {
    const before = evaluator.slots
    evaluator.arrays += 1
    const array = {
      array: node.elements.map((item) => evaluator.value(item, env)),
    }
    evaluator.arrays -= 1
    if (evaluator.arrays === 0) evaluator.eager += evaluator.slots - before
    return array
  },
  ObjectExpression: (evaluator, node, env) => ({
    object: node.properties.map((item) => [
      item.computed
        ? evaluator.value(item.key, env)
        : { name: String(item.key.name ?? item.key.value) },
      evaluator.value(item.value, env),
    ]),
  }),
  BinaryExpression: (evaluator, node, env) =>
    binary(
      node.operator,
      evaluator.value(node.left, env),
      evaluator.value(node.right, env),
    ),
  LogicalExpression: (evaluator, node, env) => ({
    operator: node.operator,
    left: evaluator.value(node.left, env),
    right: evaluator.value(node.right, env),
  }),
  UnaryExpression: (evaluator, node, env) => {
    if (node.operator === 'void' && LITERAL_TYPES.includes(node.argument.type))
      return { undefined: true }
    if (node.operator === '!' && LITERAL_TYPES.includes(node.argument.type))
      return { literal: !node.argument.value }
    return {
      unary: node.operator,
      argument: evaluator.value(node.argument, env),
    }
  },
  UpdateExpression: (evaluator, node, env) => ({
    update: node.operator,
    argument: evaluator.value(node.argument, env),
  }),
  ConditionalExpression: (evaluator, node, env) => ({
    test: evaluator.value(node.test, env),
    then: evaluator.value(node.consequent, env),
    else: evaluator.value(node.alternate, env),
  }),
  // The string concatenation it evaluates to, as the outer Preparation stage writes it: the first
  // quasi, then each expression and each nonempty quasi after it, left to right.
  TemplateLiteral: (evaluator, node, env) => {
    let chain = { literal: node.quasis[0].value.cooked }
    node.expressions.forEach((item, index) => {
      chain = { operator: '+', left: chain, right: evaluator.value(item, env) }
      const next = node.quasis[index + 1].value.cooked
      if (next !== '')
        chain = { operator: '+', left: chain, right: { literal: next } }
    })
    return chain
  },
  AssignmentExpression: (evaluator, node, env) =>
    evaluator.assign(node, env, evaluator.pending),
  SequenceExpression: (evaluator, node, env) => ({
    sequence: node.expressions.map((item) => evaluator.value(item, env)),
  }),
})

// A for loop is its init, then a while loop whose body ends with its update; the loop runs zero
// or more passes.
function loop(evaluator, node, env, out) {
  if (node.init)
    evaluator.statement(
      node.init.type === 'VariableDeclaration'
        ? node.init
        : expressionStatement(node.init),
      env,
      out,
    )
  const inner = new Map(env)
  const body = []
  const test = node.test ? evaluator.value(node.test, inner) : null
  evaluator.flush(out)
  evaluator.statement(node.body, inner, body)
  if (node.update)
    evaluator.statement(expressionStatement(node.update), inner, body)
  const kind =
    node.type === 'ForStatement' || node.type === 'WhileStatement'
      ? 'while'
      : node.type
  out.push({ loop: kind, test, body })
  join(env, 'loop', test, [new Map(env), inner])
}

// One rule per statement type: (evaluator, node, env, out).
const STATEMENT_RULES = Object.freeze({
  ExpressionStatement: (evaluator, node, env, out) => {
    const expression = node.expression
    if (expression.type === 'AssignmentExpression')
      return evaluator.assign(expression, env, out)
    const form = statementForm(expression)
    if (form) {
      for (const item of form) evaluator.statement(item, env, out)
      return
    }
    const done = evaluator.value(expression, env)
    evaluator.flush(out)
    out.push({ do: done })
  },
  VariableDeclaration: (evaluator, node, env) => {
    for (const item of node.declarations)
      if (item.init)
        env.set(evaluator.keyOf(item.id), evaluator.value(item.init, env))
  },
  BlockStatement: (evaluator, node, env, out) => {
    for (const item of node.body) evaluator.statement(item, env, out)
  },
  IfStatement: (evaluator, node, env, out) => {
    const test = evaluator.value(node.test, env)
    evaluator.flush(out)
    const then = []
    const otherwise = []
    const thenEnv = new Map(env)
    const elseEnv = new Map(env)
    evaluator.statement(node.consequent, thenEnv, then)
    if (node.alternate) evaluator.statement(node.alternate, elseEnv, otherwise)
    out.push({ if: test, then, else: otherwise })
    join(env, 'if', test, [thenEnv, elseEnv])
  },
  ThrowStatement: (evaluator, node, env, out) => {
    const thrown = evaluator.value(node.argument, env)
    evaluator.flush(out)
    out.push({ throw: thrown })
  },
  ReturnStatement: (evaluator, node, env, out) => {
    const returned = evaluator.value(node.argument, env)
    evaluator.flush(out)
    out.push({ return: returned })
  },
  ForStatement: loop,
  WhileStatement: loop,
  DoWhileStatement: loop,
  ForInStatement: loop,
  ForOfStatement: loop,
  // A debugger statement acts only under a debugger: production behaviour is unchanged.
  DebuggerStatement: () => {},
})

class EffectEvaluator {
  constructor({ keyOf, read, unbound }) {
    this.keyOf = keyOf
    this.read = read
    this.unbound = unbound
    this.slots = 0
    // Operand reads made inside array literals: an alias or anti handler reads all of its operands
    // up front into one array.
    this.eager = 0
    this.arrays = 0
    // Writes made inside an expression (`if ((x = e))`), flushed before the effect that holds them.
    this.pending = []
  }

  flush(out) {
    out.push(...this.pending.splice(0))
  }

  value(node, env) {
    if (!node) return null
    if (!Object.hasOwn(VALUE_RULES, node.type)) return { node: node.type }
    return VALUE_RULES[node.type](this, node, env)
  }

  // JavaScript evaluates an assignment's target (object, then index) before its value, so operand
  // reads are numbered in that order.
  assign(node, env, out) {
    const target =
      node.left.type === 'Identifier' ? null : this.value(node.left, env)
    const right =
      node.operator === '='
        ? this.value(node.right, env)
        : binary(
            node.operator.slice(0, -1),
            target ?? this.value(node.left, env),
            this.value(node.right, env),
          )
    if (node.left.type === 'Identifier') env.set(this.keyOf(node.left), right)
    else {
      if (out !== this.pending) this.flush(out)
      out.push({ set: target, value: right })
    }
    return right
  }

  statement(node, env, out) {
    if (!Object.hasOwn(STATEMENT_RULES, node.type)) {
      out.push({ statement: node.type })
      return
    }
    STATEMENT_RULES[node.type](this, node, env, out)
  }

  run(nodes) {
    const effects = []
    const env = new Map()
    for (const node of nodes) this.statement(node, env, effects)
    return {
      effects,
      operands: this.slots,
      eager: this.slots > 0 && this.eager === this.slots,
    }
  }
}

const isSlot = (term) =>
  term &&
  typeof term === 'object' &&
  'op' in term &&
  Object.keys(term).length === 1

// Whether `actual` does what `reference` does with each reference operand slot bound to one
// actual term: a literal (a baked operand) or an actual slot (a permuted operand). The binding is
// recorded in `slots` (reference slot -> actual term).
export function unifyEffects(reference, actual, slots = new Map()) {
  if (isSlot(reference)) {
    if (slots.has(reference.op))
      return JSON.stringify(slots.get(reference.op)) === JSON.stringify(actual)
    if (
      !isSlot(actual) &&
      !(actual && typeof actual === 'object' && 'literal' in actual)
    )
      return false
    slots.set(reference.op, actual)
    return true
  }
  if (Array.isArray(reference))
    return (
      Array.isArray(actual) &&
      reference.length === actual.length &&
      reference.every((item, index) => unifyEffects(item, actual[index], slots))
    )
  if (reference === null || typeof reference !== 'object')
    return reference === actual
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
    return false
  const keys = Object.keys(reference).sort()
  const actualKeys = Object.keys(actual).sort()
  return (
    keys.length === actualKeys.length &&
    keys.every(
      (key, index) =>
        key === actualKeys[index] &&
        unifyEffects(reference[key], actual[key], slots),
    )
  )
}

// Every way to read `effects` as consecutive references, each with its slot binding.
export function decomposeEffects(references, effects, limit = 2) {
  const found = []
  const walk = (start, parts) => {
    if (found.length >= limit) return
    if (start === effects.length) {
      found.push(parts)
      return
    }
    for (const reference of references) {
      const length = reference.effects.length
      if (length === 0 || start + length > effects.length) continue
      const slots = new Map()
      if (
        !unifyEffects(
          reference.effects,
          effects.slice(start, start + length),
          slots,
        )
      )
        continue
      walk(start + length, [...parts, { reference, slots }])
    }
  }
  walk(0, [])
  return found
}
