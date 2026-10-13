function union(...sets) {
  return new Set(sets.flatMap((set) => [...set]))
}
function equal(a, b) {
  return a.size === b.size && [...a].every((item) => b.has(item))
}
// Backward liveness includes branch joins and loop back edges. Variable reuse
// is accepted only after the previous logical role's last possible read.
export function clauseLiveness(node, identity, onDefinition = () => {}) {
  const read = (node) => (node?.type === 'Identifier' ? identity(node) : null)
  function analyze(node, out) {
    if (!node || typeof node !== 'object') return new Set(out)
    if (Array.isArray(node))
      return node.reduceRight((live, item) => analyze(item, live), new Set(out))
    const symbol = read(node)
    if (symbol) return union(out, new Set([symbol]))
    if (node.type === 'Identifier' || node.type === 'ThisExpression')
      return new Set(out)
    if (node.type === 'MemberExpression')
      return analyze(
        node.object,
        node.computed ? analyze(node.property, out) : out,
      )
    if (node.type === 'ObjectProperty')
      return analyze(node.value, node.computed ? analyze(node.key, out) : out)
    if (
      node.type === 'AssignmentExpression' &&
      node.left?.type === 'Identifier'
    ) {
      const target = read(node.left),
        live = new Set(out)
      if (target) {
        onDefinition(target, out)
        live.delete(target)
      }
      if (node.operator !== '=' && target) live.add(target)
      return analyze(node.right, live)
    }
    if (
      node.type === 'UpdateExpression' &&
      node.argument?.type === 'Identifier'
    ) {
      const target = read(node.argument)
      if (target) onDefinition(target, out)
      return target ? union(out, new Set([target])) : new Set(out)
    }
    if (node.type === 'IfStatement' || node.type === 'ConditionalExpression')
      return analyze(
        node.test,
        union(analyze(node.consequent, out), analyze(node.alternate, out)),
      )
    if (node.type === 'LogicalExpression')
      return analyze(node.left, union(out, analyze(node.right, out)))
    if (node.type === 'ForStatement' || node.type === 'WhileStatement') {
      let live = new Set(out)
      for (;;) {
        const next = union(
          out,
          analyze(node.test, analyze(node.body, analyze(node.update, live))),
        )
        if (equal(next, live)) return analyze(node.init, next)
        live = next
      }
    }
    if (node.type === 'FunctionExpression') {
      const captured = analyze(node.body, new Set())
      for (const param of node.params) captured.delete(read(param))
      return union(out, captured)
    }
    if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement')
      return analyze(node.argument, new Set())
    if (node.type === 'BreakStatement' || node.type === 'ContinueStatement')
      return new Set(out)
    return Object.entries(node)
      .filter(([key]) => key !== 'type')
      .reduceRight((live, [, value]) => analyze(value, live), new Set(out))
  }
  return analyze(node, new Set())
}
export function compatibleRoleBindings(pattern, roles) {
  const identity = (node) =>
    node.name.startsWith('$') ? node.name.slice(1) : null
  let compatible = true
  const compare = (target, live) => {
    for (const name of live)
      if (
        name !== target &&
        roles.has(name) &&
        roles.has(target) &&
        roles.get(name) === roles.get(target)
      )
        compatible = false
  }
  const incoming = clauseLiveness(pattern, identity, compare)
  for (const name of incoming) compare(name, incoming)
  return compatible
}
