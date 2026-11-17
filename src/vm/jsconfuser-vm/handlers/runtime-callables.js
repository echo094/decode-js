import {
  isStableDeclaration,
  numberValue,
  propertyName,
} from '../source/container-role-helpers.js'

// The runtime's declarations as the handler locator reads them: the function a binding holds, each
// callable's parameters and decoy layout, and the stable numeric values labels and fields read.

export function isDummyLiteral(node) {
  return (
    (node?.type === 'UnaryExpression' &&
      node.operator === 'void' &&
      node.argument.type === 'NumericLiteral') ||
    node?.type === 'NullLiteral' ||
    node?.type === 'NumericLiteral' ||
    node?.type === 'StringLiteral' ||
    (node?.type === 'Identifier' && node.name === 'undefined') ||
    (node?.type === 'ArrayExpression' && node.elements.length === 0) ||
    (node?.type === 'ObjectExpression' && node.properties.length === 0)
  )
}

function within(path, ancestor) {
  for (let current = path; current; current = current.parentPath) {
    if (current.node === ancestor) return true
  }
  return false
}

function fakeExpression(node, parameters, context) {
  if (node?.type === 'Identifier')
    return parameters.has(context.bindingFor(node))
  if (node?.type !== 'ArrayExpression' && node?.type !== 'LogicalExpression')
    return isDummyLiteral(node)
  if (node?.type === 'ArrayExpression')
    return node.elements.every((item) =>
      fakeExpression(item, parameters, context),
    )
  if (node?.type === 'LogicalExpression')
    return (
      ['&&', '||'].includes(node.operator) &&
      fakeExpression(node.left, parameters, context) &&
      fakeExpression(node.right, parameters, context)
    )
  return false
}

export function functionOf(declaration) {
  return declaration.init?.type === 'FunctionDeclaration' ||
    declaration.init?.type === 'FunctionExpression'
    ? declaration.init
    : null
}

// The function a top-level binding stably holds, through stable aliases such as `var a = b`.
export function functionFor(context, declarations, node, seen = new Set()) {
  const binding = context.bindingFor(node)
  if (!binding || seen.has(binding)) return null
  seen.add(binding)
  const found = declarations.filter((item) => item.binding === binding)
  if (found.length === 1 && isStableDeclaration(found[0])) {
    if (found[0].kind === 'function') return found[0]
    if (found[0].init?.type === 'Identifier')
      return functionFor(context, declarations, found[0].init, seen)
    return null
  }
  // A declarator outside the top-level statements (a for-loop initializer) that is never written.
  const alias = binding.path.isVariableDeclarator()
    ? binding.path.node.init
    : null
  return found.length === 0 &&
    binding.constantViolations.length === 0 &&
    alias?.type === 'Identifier'
    ? functionFor(context, declarations, alias, seen)
    : null
}

// Class obfuscation adds decoy parameters and stores them into a new field nothing reads; its call
// sites pass dummy literals for them. Minify then moves the store and may reuse the parameter as a
// local. The store is removed first: a write of parameters or dummy literals into the receiver's
// field (`this` in a method, the first parameter in a devirtualized function) that no code reads.
// A parameter is then dead when nothing reads it, or when its first use overwrites it.
export function callableLayout(context, fn, selfBinding, readFields) {
  if (!fn.params.every((param) => param.type === 'Identifier')) return null
  // The callable's own state: `this`, and for a devirtualized method its first parameter too.
  const isSelf = (node) =>
    node?.type === 'ThisExpression' ||
    (selfBinding !== null && context.isReference(node, selfBinding))
  const bindings = fn.params.map((param) => context.bindingFor(param))
  const parameters = new Set(bindings)
  const decoyWrites = context
    .nodes(fn)
    .map(({ node }) => node)
    .filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.operator === '=' &&
        node.left?.type === 'MemberExpression' &&
        !node.left.computed &&
        isSelf(node.left.object) &&
        fakeExpression(node.right, parameters, context) &&
        !readFields.has(propertyName(node.left.property)),
    )
  const decoys = new Set()
  for (const [index, binding] of bindings.entries()) {
    // A use reads the parameter (a compound assignment reads its target too) or overwrites it.
    const overwrites = (path) =>
      path.parentPath.isAssignmentExpression({ operator: '=' }) &&
      path.key === 'left' &&
      context.bindingFor(path.node) === binding
    const uses = context
      .nodes(fn)
      .filter(
        ({ node, path }) =>
          node.type === 'Identifier' &&
          (context.isReference(node, binding) ||
            (path.parentPath.isAssignmentExpression() &&
              path.key === 'left' &&
              context.bindingFor(node) === binding)) &&
          !decoyWrites.some((write) => within(path, write.right)),
      )
      .sort((left, right) => left.node.start - right.node.start)
    const first = uses[0]?.path
    if (
      !first ||
      (overwrites(first) &&
        !context
          .nodes(first.parent.right)
          .some(({ node }) => context.isReference(node, binding)))
    )
      decoys.add(index)
  }
  // Arguments past the parameters are never read unless the body uses `arguments`.
  const readsArguments = context
    .nodes(fn)
    .some(
      ({ node, path }) =>
        node.type === 'Identifier' &&
        node.name === 'arguments' &&
        path.getFunctionParent()?.node === fn,
    )
  return {
    arity: bindings.length,
    decoys,
    decoyWrites,
    bindings,
    readsArguments,
  }
}

// The number a value always holds: a literal, a top-level binding stably holding one (an
// object-extracted map member, `var x;` with its single top-level `x = 7`), or a stable numeric
// map's member (`OP.ADD`). Each spells the same case label or frame offset.
export function labelValue(context, declarations, test) {
  const literal = numberValue(test)
  if (Number.isSafeInteger(literal)) return literal
  if (test?.type === 'Identifier') {
    const binding = context.bindingFor(test)
    const held = declarations.find(
      (item) =>
        item.kind === 'variable' &&
        binding &&
        item.binding === binding &&
        isStableDeclaration(item),
    )
    const value = numberValue(held?.init)
    return Number.isSafeInteger(value) ? value : null
  }
  if (test?.type !== 'MemberExpression' || test.computed) return null
  const binding = context.bindingFor(test.object)
  const map = declarations.find(
    (item) =>
      item.kind === 'variable' &&
      item.binding === binding &&
      isStableDeclaration(item) &&
      item.init?.type === 'ObjectExpression',
  )
  if (!map) return null
  const key = propertyName(test.property)
  const property = map.init.properties.find(
    (item) =>
      item.type === 'ObjectProperty' &&
      !item.computed &&
      propertyName(item.key) === key,
  )
  const value = numberValue(property?.value)
  return Number.isSafeInteger(value) ? value : null
}

export function caseStatements(entry) {
  return entry.consequent.length === 1 &&
    entry.consequent[0].type === 'BlockStatement'
    ? entry.consequent[0].body
    : entry.consequent
}

// `this.field = parameter` statements directly in a constructor body, by parameter position.
export function storedFields(context, fn) {
  const fields = new Map()
  for (const statement of fn.body.body) {
    const node = statement.expression
    if (
      statement.type !== 'ExpressionStatement' ||
      node?.type !== 'AssignmentExpression' ||
      node.operator !== '=' ||
      node.left.type !== 'MemberExpression' ||
      node.left.computed ||
      node.left.object.type !== 'ThisExpression'
    )
      continue
    const binding = context.bindingFor(node.right)
    const index = fn.params.findIndex(
      (param) => context.bindingFor(param) === binding,
    )
    if (binding && index >= 0)
      fields.set(index, propertyName(node.left.property))
  }
  return fields
}
