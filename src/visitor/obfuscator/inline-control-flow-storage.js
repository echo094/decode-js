import * as t from '@babel/types'

/**
 * Obfuscator-specific fork of the shared `visitor/parse-control-flow-storage.js`.
 *
 * Named for what it does rather than after the file it forked from: a filename search for the
 * shared name must not return two implementations that no longer agree.
 *
 * javascript-obfuscator 3.2.0's stringArrayCallsTransform stores string-array indexes as numeric
 * literal properties. The shared visitor deliberately keeps its older accepted set, because this
 * additional spelling is not established for its sojson and sojsonv7 consumers.
 *
 * The wrapper matcher accepts the same function, string-literal and member-expression entries as
 * the shared visitor, and the copied fixtures pin that. Three behaviours deliberately diverge, so
 * this is not the shared visitor plus one branch:
 *
 * - the declarator id must be an identifier. The shared visitor reads `.name` off a destructuring
 *   pattern, gets undefined, and throws on the binding lookup.
 * - every reference is preflighted before the first replacement. The shared visitor applies each
 *   resolvable read as it goes and only then declines to remove the declaration, so a storage read
 *   sitting beside an unsupported *write* is inlined to the pre-write value — a silent change of
 *   program output. The cost of preflighting is real: where any reference is unresolvable this
 *   declines the whole storage, including reads the shared visitor would still resolve.
 * - the crawl runs from the Program scope, after removal. A local crawl leaves enclosing bindings
 *   describing the tree from before the rewrite, which the pre-string-array slot's detector reads.
 *
 * The first two are defects the shared visitor still carries for its three consumers. They are not
 * fixed there because that decision needs evidence from sojson and sojsonv7, which this corpus
 * cannot supply.
 */
function parseObject(path) {
  const node = path.node
  if (!t.isIdentifier(node.id) || !t.isObjectExpression(node.init)) return

  const properties = node.init.properties
  if (!properties.length) return

  const objKeys = {}
  let replacementCount = 0

  for (const prop of properties) {
    if (!t.isObjectProperty(prop)) continue

    const key = t.isIdentifier(prop.key) ? prop.key.name : prop.key.value
    let replace

    if (t.isFunctionExpression(prop.value)) {
      if (prop.value.body.body.length !== 1) continue
      const statement = prop.value.body.body[0]
      if (!t.isReturnStatement(statement)) continue

      const value = statement.argument
      if (t.isBinaryExpression(value) || t.isLogicalExpression(value)) {
        if (prop.value.params.length !== 2) continue
        replace = (target, args) => {
          const nodeFactory = t.isBinaryExpression(value)
            ? t.binaryExpression
            : t.logicalExpression
          target.replaceWith(nodeFactory(value.operator, args[0], args[1]))
        }
      } else if (
        t.isCallExpression(value) ||
        t.isOptionalCallExpression(value)
      ) {
        if (
          !t.isIdentifier(value.callee) ||
          value.callee.name !== prop.value.params[0]?.name
        ) {
          continue
        }
        replace = (target, args) => {
          const callee = args[0]
          const callArguments = args.slice(1)
          const call = t.isOptionalCallExpression(value)
            ? t.optionalCallExpression(callee, callArguments, value.optional)
            : t.callExpression(callee, callArguments)
          target.replaceWith(call)
        }
      }
    } else if (t.isStringLiteral(prop.value)) {
      const literal = prop.value.value
      replace = (target) => target.replaceWith(t.stringLiteral(literal))
    } else if (t.isNumericLiteral(prop.value)) {
      const literal = prop.value.value
      replace = (target) => target.replaceWith(t.numericLiteral(literal))
    } else if (t.isMemberExpression(prop.value)) {
      const value = prop.value
      replace = (target) => target.replaceWith(value)
    }

    if (replace) {
      objKeys[key] = replace
      replacementCount++
    }
  }

  if (!replacementCount || properties.length !== replacementCount) return

  const binding = path.scope.getBinding(node.id.name)
  if (!binding) return
  const references = [...binding.referencePaths]
  const programScope = path.scope.getProgramParent()

  const getReplacement = (member) => {
    const property = member.node.property
    const key = t.isStringLiteral(property)
      ? property.value
      : t.isIdentifier(property)
        ? property.name
        : null
    if (key === null || !Object.prototype.hasOwnProperty.call(objKeys, key))
      return null
    return objKeys[key]
  }

  // Preflight every reference before changing the AST. A storage can contain a supported read
  // and an unsupported write; applying the read first would leave the declaration in place while
  // changing only part of the tree, weakening the gate that protects ordinary objects.
  const operations = []
  for (const reference of references) {
    const member = reference.parentPath
    if (!member.isMemberExpression() || reference.key !== 'object') continue
    if (member.key === 'left' && member.parentPath.isAssignmentExpression())
      continue

    const replace = getReplacement(member)
    if (!replace) continue
    operations.push({ member, replace })
  }

  // Keep this diagnostic aligned with the shared visitor's fail-closed behavior without making a
  // partial numeric-storage match destructive. In particular, do not crawl scopes on this path:
  // the unsupported case must leave the whole tree untouched.
  if (operations.length !== references.length) {
    console.warn(
      `[obfuscatorx] kept storage ${node.id.name}: ${operations.length}/${references.length} references resolved`,
    )
    return
  }

  // Replace reversely to handle nested calls correctly, after the preflight has accepted every
  // reference.
  for (let i = operations.length - 1; i >= 0; i--) {
    const { member, replace } = operations[i]
    if (member.key === 'callee') {
      replace(member.parentPath, member.parentPath.node.arguments)
    } else replace(member)
  }

  path.remove()
  programScope.crawl()
}

export default {
  VariableDeclarator: {
    exit: parseObject,
  },
}
