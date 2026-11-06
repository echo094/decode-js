import { cloneRuntimeFragment } from './runtime-fragment-pattern.js'

// What a handler does, independent of how a runtime layer spelled it. The lowered handler is
// evaluated symbolically: each operand read becomes a slot numbered in read order (`{op: k}`; a
// constant read without explicit arguments reads two), a literal stays a value, and a local is a
// carrier of its value, so whether minify kept or folded it changes nothing. A statement-level
// `a || b`, `a && b` or `c ? x : y` is the `if` it stands for. The result is the list of effects:
// writes to anything but a local, calls, conditionals, loops, throws and returns.

export function handlerEffects(view, handler, identities = new Map()) {
  const statements = handler.body.filter(
    (statement) =>
      statement.type !== 'BreakStatement' &&
      statement.type !== 'EmptyStatement',
  )
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

function evaluateEffects(nodes, { keyOf, read, unbound }) {
  let slots = 0
  // Operand reads made inside array literals: an alias or anti handler reads all of its operands
  // up front into one array.
  let eager = 0
  let arrays = 0
  // Writes made inside an expression (`if ((x = e))`), flushed before the effect that holds them.
  const pending = []
  const flush = (out) => out.push(...pending.splice(0))
  // Bitwise chains associate on int32 values, so a regrouped chain is one list of operands.
  const ASSOCIATIVE = new Set(['^', '&', '|'])
  // A compound assignment (`x &= y`) and a written-out chain build the same term.
  const binary = (operator, left, right) => {
    if (!ASSOCIATIVE.has(operator)) return { operator, left, right }
    const parts = (term) =>
      term?.operator === operator && Array.isArray(term.operands)
        ? term.operands
        : [term]
    return { operator, operands: [...parts(left), ...parts(right)] }
  }
  const value = (node, env) => {
    if (!node) return null
    switch (node.type) {
      case 'CallExpression': {
        const name = node.callee.type === 'Identifier' ? node.callee.name : null
        if (name === '$operand') return { op: slots++ }
        if (name === '$constant')
          return node.arguments.length === 0
            ? { constant: [{ op: slots++ }, { op: slots++ }] }
            : { constant: node.arguments.map((item) => value(item, env)) }
        const callee = value(node.callee, env)
        const args = node.arguments.map((item) => value(item, env))
        // `Array(n)` constructs as `new Array(n)` does.
        if (callee?.global === 'Array') return { new: callee, args }
        return { call: callee, args }
      }
      case 'NewExpression':
        return {
          new: value(node.callee, env),
          args: node.arguments.map((item) => value(item, env)),
        }
      case 'NumericLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return { literal: node.value }
      case 'NullLiteral':
        return { literal: null }
      case 'ThisExpression':
        return { this: true }
      case 'Identifier': {
        if (node.name === 'undefined' && unbound(node))
          return { undefined: true }
        const key = keyOf(node)
        return env.has(key) ? env.get(key) : read(node)
      }
      case 'MemberExpression': {
        const object = value(node.object, env)
        const property = node.computed
          ? value(node.property, env)
          : { name: node.property.name }
        // An operand array indexed by a literal is that element: an alias reads its permuted
        // operands this way.
        if (object?.array && Number.isInteger(property?.literal))
          return object.array[property.literal] ?? { undefined: true }
        return { get: [object, property] }
      }
      case 'ArrayExpression': {
        const before = slots
        arrays += 1
        const array = { array: node.elements.map((item) => value(item, env)) }
        arrays -= 1
        if (arrays === 0) eager += slots - before
        return array
      }
      case 'ObjectExpression':
        return {
          object: node.properties.map((item) => [
            item.computed
              ? value(item.key, env)
              : { name: String(item.key.name ?? item.key.value) },
            value(item.value, env),
          ]),
        }
      case 'BinaryExpression':
        return binary(
          node.operator,
          value(node.left, env),
          value(node.right, env),
        )
      case 'LogicalExpression':
        return {
          operator: node.operator,
          left: value(node.left, env),
          right: value(node.right, env),
        }
      case 'UnaryExpression': {
        // Minify's spellings of constants: `void 0` is undefined, `!0` and `!1` are booleans.
        const literal = ['NumericLiteral', 'BooleanLiteral', 'StringLiteral']
        if (node.operator === 'void' && literal.includes(node.argument.type))
          return { undefined: true }
        if (node.operator === '!' && literal.includes(node.argument.type))
          return { literal: !node.argument.value }
        return { unary: node.operator, argument: value(node.argument, env) }
      }
      case 'UpdateExpression':
        return { update: node.operator, argument: value(node.argument, env) }
      case 'ConditionalExpression':
        return {
          test: value(node.test, env),
          then: value(node.consequent, env),
          else: value(node.alternate, env),
        }
      case 'TemplateLiteral': {
        // The string concatenation it evaluates to, as the outer Preparation stage writes it:
        // the first quasi, then each expression and each nonempty quasi after it, left to right.
        let chain = { literal: node.quasis[0].value.cooked }
        node.expressions.forEach((item, index) => {
          chain = { operator: '+', left: chain, right: value(item, env) }
          const next = node.quasis[index + 1].value.cooked
          if (next !== '')
            chain = { operator: '+', left: chain, right: { literal: next } }
        })
        return chain
      }
      case 'AssignmentExpression':
        return assign(node, env, pending)
      case 'SequenceExpression':
        return { sequence: node.expressions.map((item) => value(item, env)) }
      default:
        return { node: node.type }
    }
  }
  // JavaScript evaluates an assignment's target (object, then index) before its value, so operand
  // reads are numbered in that order.
  const assign = (node, env, out) => {
    const target =
      node.left.type === 'Identifier' ? null : value(node.left, env)
    const right =
      node.operator === '='
        ? value(node.right, env)
        : binary(
            node.operator.slice(0, -1),
            target ?? value(node.left, env),
            value(node.right, env),
          )
    if (node.left.type === 'Identifier') env.set(keyOf(node.left), right)
    else {
      if (out !== pending) flush(out)
      out.push({ set: target, value: right })
    }
    return right
  }
  const asIf = (test, consequent, alternate = null) => ({
    type: 'IfStatement',
    test,
    consequent: { type: 'ExpressionStatement', expression: consequent },
    alternate: alternate && {
      type: 'ExpressionStatement',
      expression: alternate,
    },
  })
  // A local written inside a conditional or loop holds, after it, what the paths leave: the one
  // value when every path agrees, otherwise the join of the paths' values.
  const join = (env, kind, test, branches) => {
    const keys = new Set(branches.flatMap((branch) => [...branch.keys()]))
    for (const key of keys) {
      const values = branches.map((branch) =>
        branch.has(key) ? branch.get(key) : (env.get(key) ?? { unset: true }),
      )
      const before = env.has(key) ? JSON.stringify(env.get(key)) : null
      if (values.every((item) => JSON.stringify(item) === before)) continue
      env.set(
        key,
        values.every(
          (item) => JSON.stringify(item) === JSON.stringify(values[0]),
        )
          ? values[0]
          : { join: kind, test, values },
      )
    }
  }
  const statement = (node, env, out) => {
    switch (node.type) {
      case 'ExpressionStatement': {
        const expression = node.expression
        if (expression.type === 'AssignmentExpression')
          return assign(expression, env, out)
        if (
          expression.type === 'LogicalExpression' &&
          expression.operator !== '??'
        )
          return statement(
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
            env,
            out,
          )
        if (expression.type === 'ConditionalExpression')
          return statement(
            asIf(expression.test, expression.consequent, expression.alternate),
            env,
            out,
          )
        if (expression.type === 'SequenceExpression') {
          for (const item of expression.expressions)
            statement(
              { type: 'ExpressionStatement', expression: item },
              env,
              out,
            )
          return
        }
        const done = value(expression, env)
        flush(out)
        out.push({ do: done })
        return
      }
      case 'VariableDeclaration':
        for (const item of node.declarations)
          if (item.init) env.set(keyOf(item.id), value(item.init, env))
        return
      case 'BlockStatement':
        for (const item of node.body) statement(item, env, out)
        return
      case 'IfStatement': {
        const test = value(node.test, env)
        flush(out)
        const then = []
        const otherwise = []
        const thenEnv = new Map(env)
        const elseEnv = new Map(env)
        statement(node.consequent, thenEnv, then)
        if (node.alternate) statement(node.alternate, elseEnv, otherwise)
        out.push({ if: test, then, else: otherwise })
        join(env, 'if', test, [thenEnv, elseEnv])
        return
      }
      case 'ThrowStatement': {
        const thrown = value(node.argument, env)
        flush(out)
        out.push({ throw: thrown })
        return
      }
      case 'ReturnStatement': {
        const returned = value(node.argument, env)
        flush(out)
        out.push({ return: returned })
        return
      }
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        // A for loop is its init, then a while loop whose body ends with its update.
        if (node.init)
          statement(
            node.init.type === 'VariableDeclaration'
              ? node.init
              : { type: 'ExpressionStatement', expression: node.init },
            env,
            out,
          )
        const inner = new Map(env)
        const body = []
        const test = node.test ? value(node.test, inner) : null
        flush(out)
        statement(node.body, inner, body)
        if (node.update)
          statement(
            { type: 'ExpressionStatement', expression: node.update },
            inner,
            body,
          )
        const kind =
          node.type === 'ForStatement' || node.type === 'WhileStatement'
            ? 'while'
            : node.type
        out.push({ loop: kind, test, body })
        join(env, 'loop', test, [new Map(env), inner]) // zero or more passes
        return
      }
      // A debugger statement acts only under a debugger: production behaviour is unchanged.
      case 'DebuggerStatement':
        return
      default:
        out.push({ statement: node.type })
    }
  }
  const effects = []
  const env = new Map()
  for (const node of nodes) statement(node, env, effects)
  return { effects, operands: slots, eager: slots > 0 && eager === slots }
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
