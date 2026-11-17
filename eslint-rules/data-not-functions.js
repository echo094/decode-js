// A file never hands a function to a file it imports (CONTRIBUTING.md, Dependencies).
// Functions travel up the import graph only: what a file exports and what its functions return.
// Reported: a function passed to a function or class imported from one of our files, or held by
// an object literal that is neither exported, returned, a frozen dispatch map nor a Babel visitor
// (a frame or context built to be passed down); a function stored in a `this` field; methods
// assigned onto a prototype.
import { visitors } from '@babel/traverse'

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
])
const VISITOR_OPTIONS = new Set([
  'noScope',
  'denylist',
  'blacklist',
  'shouldSkip',
  'skipKeys',
])

const keyName = (property) =>
  property.key.type === 'Identifier' ? property.key.name : property.key.value

// Babel's own check: every key a node type, alias, virtual type, `A|B` list, `enter`/`exit` or an
// option, nested `{ enter, exit }` included.
function isVisitor(object) {
  if (!object.properties.length) return false
  const shape = {}
  for (const property of object.properties) {
    if (property.type !== 'Property' || property.computed) return false
    const key = keyName(property)
    if (typeof key !== 'string') return false
    if (VISITOR_OPTIONS.has(key)) continue
    for (const name of key.split('|')) shape[name] = () => {}
  }
  try {
    visitors.verify(shape)
    return true
  } catch {
    return false
  }
}

const isObjectFreeze = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.name === 'Object' &&
  node.callee.property.name === 'freeze'

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'A file never hands a function to a file it imports',
    },
    schema: [],
  },
  create(context) {
    const source = context.sourceCode
    const variableOf = (node) => {
      for (let scope = source.getScope(node); scope; scope = scope.upper) {
        const found = scope.set.get(node.name)
        if (found) return found
      }
      return null
    }
    // The relative path a callee is imported from, or null.
    const importedFrom = (callee) => {
      if (callee?.type !== 'Identifier') return null
      const def = variableOf(callee)?.defs[0]
      return def?.type === 'ImportBinding' &&
        def.parent.source.value.startsWith('.')
        ? def.parent.source.value
        : null
    }
    const methodsOf = (node) => {
      for (let at = node; at; at = at.parent)
        if (at.type === 'ClassBody')
          return new Set(
            at.body
              .filter((member) => member.type === 'MethodDefinition')
              .map((member) => member.key.name),
          )
      return new Set()
    }
    // What function `node` evaluates to, or null when syntax shows none.
    const functionValue = (node) => {
      if (!node) return null
      if (FUNCTION_TYPES.has(node.type)) return 'a function'
      if (
        node.type === 'CallExpression' &&
        node.callee.property?.name === 'bind'
      )
        return 'a bound function'
      if (node.type === 'Identifier') {
        const def = variableOf(node)?.defs[0]
        if (def?.type === 'FunctionName') return `function ${node.name}`
        if (def?.type === 'Variable' && FUNCTION_TYPES.has(def.node.init?.type))
          return `function ${node.name}`
      }
      if (node.type !== 'MemberExpression' || node.computed) return null
      if (
        node.object.type === 'ThisExpression' &&
        methodsOf(node).has(node.property.name)
      )
        return `method ${node.property.name}`
      // `o.f` where `o` is bound to an object literal whose `f` is a function.
      if (node.object.type === 'Identifier') {
        const init = variableOf(node.object)?.defs[0]?.node.init
        const held =
          init?.type === 'ObjectExpression'
            ? init.properties.find(
                (property) =>
                  property.type === 'Property' &&
                  keyName(property) === node.property.name,
              )
            : null
        if (held && functionValue(held.value))
          return `function ${node.object.name}.${node.property.name}`
      }
      return null
    }
    // Where a value at `node` goes: 'down' into one of our imported files (an argument of its
    // function or class, or a `this` field an instance carries), otherwise nowhere that can call
    // back (exported, returned, used in this file, or handed to a library).
    const goesDown = (node) => {
      const parent = node.parent
      if (
        (parent.type === 'CallExpression' || parent.type === 'NewExpression') &&
        parent.arguments.includes(node)
      )
        return Boolean(importedFrom(parent.callee))
      if (parent.type === 'AssignmentExpression' && parent.right === node)
        return (
          parent.left.type === 'MemberExpression' &&
          parent.left.object.type === 'ThisExpression'
        )
      if (parent.type === 'Property' && parent.value === node)
        return (
          parent.parent.type === 'ObjectExpression' &&
          objectGoesDown(parent.parent)
        )
      if (parent.type === 'VariableDeclarator' && parent.init === node) {
        if (parent.parent.parent.type === 'ExportNamedDeclaration') return false
        const variable = variableOf(parent.id)
        return Boolean(
          variable?.references.some(
            ({ identifier }) =>
              identifier !== parent.id && goesDown(identifier),
          ),
        )
      }
      return false
    }
    // An object literal that goes down, unless it is a frozen dispatch map or a Babel visitor.
    const objectGoesDown = (object) =>
      !isObjectFreeze(object.parent) && !isVisitor(object) && goesDown(object)
    const report = (node, message) => context.report({ node, message })

    const handover = (node) => {
      const from = importedFrom(node.callee)
      if (!from) return
      for (const argument of node.arguments) {
        const what = functionValue(argument)
        if (what)
          report(argument, `${what} handed to ${node.callee.name} (${from})`)
      }
    }
    return {
      CallExpression(node) {
        handover(node)
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          callee.object.name === 'Object' &&
          callee.property.name === 'assign' &&
          node.arguments[0]?.type === 'MemberExpression' &&
          node.arguments[0].property.name === 'prototype'
        )
          report(node, 'methods assigned onto a prototype')
      },
      NewExpression: handover,
      AssignmentExpression(node) {
        const what = functionValue(node.right)
        if (
          what &&
          node.left.type === 'MemberExpression' &&
          node.left.object.type === 'ThisExpression'
        )
          report(
            node.right,
            `${what} stored in this.${node.left.property.name}`,
          )
      },
      ObjectExpression(node) {
        if (!objectGoesDown(node)) return
        for (const property of node.properties) {
          if (property.type !== 'Property') continue
          const what = functionValue(property.value)
          if (what)
            report(
              property.value,
              `${what} held by an object passed on (${keyName(property)})`,
            )
        }
      },
    }
  },
}
