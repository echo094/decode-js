import * as t from '@babel/types'

import bindingDef from '../../utility/binding-def.js'
const resolveBindingValue = bindingDef.resolveBindingValue
const resolveBindingFunction = bindingDef.resolveBindingFunction

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode

/**
 * Reads the flat-object literal built by the Flatten wrapper (see flatten.ts
 * flattenFunction): every property is an ObjectMethod proxying to one outer-scope
 * identifier, tagged by how the original reference was used (plain read/write,
 * `typeof`, or direct call). Returns null if any property doesn't match one of
 * those three exact shapes - a partial match is treated as "not this pattern"
 * rather than partially decoded.
 */
function readFlatObjectProps(objectExpression) {
  const props = new Map()
  for (const prop of objectExpression.properties) {
    if (
      !t.isObjectMethod(prop) ||
      prop.computed ||
      !t.isStringLiteral(prop.key)
    ) {
      return null
    }
    const key = prop.key.value
    const body = prop.body.body

    if (prop.kind === 'get') {
      if (body.length !== 1 || !t.isReturnStatement(body[0])) return null
      const arg = body[0].argument
      if (t.isIdentifier(arg)) {
        const existing = props.get(key)
        if (existing && existing.kind !== 'value') return null
        props.set(key, { kind: 'value', outerName: arg.name })
      } else if (
        t.isUnaryExpression(arg) &&
        arg.operator === 'typeof' &&
        t.isIdentifier(arg.argument)
      ) {
        props.set(key, { kind: 'typeof', outerName: arg.argument.name })
      } else {
        return null
      }
    } else if (prop.kind === 'set') {
      if (
        prop.params.length !== 1 ||
        !t.isIdentifier(prop.params[0]) ||
        body.length !== 1 ||
        !t.isExpressionStatement(body[0]) ||
        !t.isAssignmentExpression(body[0].expression) ||
        body[0].expression.operator !== '='
      ) {
        return null
      }
      const assign = body[0].expression
      if (
        !t.isIdentifier(assign.left) ||
        !t.isIdentifier(assign.right) ||
        assign.right.name !== prop.params[0].name
      ) {
        return null
      }
      const existing = props.get(key)
      if (existing) {
        if (
          existing.kind !== 'value' ||
          existing.outerName !== assign.left.name
        ) {
          return null
        }
      } else {
        props.set(key, { kind: 'value', outerName: assign.left.name })
      }
    } else if (prop.kind === 'method') {
      if (
        prop.params.length !== 1 ||
        !t.isRestElement(prop.params[0]) ||
        !t.isIdentifier(prop.params[0].argument) ||
        body.length !== 1 ||
        !t.isReturnStatement(body[0]) ||
        !t.isCallExpression(body[0].argument)
      ) {
        return null
      }
      const call = body[0].argument
      const argsName = prop.params[0].argument.name
      if (
        !t.isIdentifier(call.callee) ||
        call.arguments.length !== 1 ||
        !t.isSpreadElement(call.arguments[0]) ||
        !t.isIdentifier(call.arguments[0].argument) ||
        call.arguments[0].argument.name !== argsName
      ) {
        return null
      }
      props.set(key, { kind: 'call', outerName: call.callee.name })
    } else {
      return null
    }
  }
  return props
}

/**
 * Matches the wrapper left behind at the original function's position:
 *   function original(...args) {
 *     var flatObject = { get "prop"() {...}, ... };
 *     return flatFn(flatObject, args);
 *   }
 *
 * Read from the `return` backwards and through the binding, not as a fixed two-statement
 * body. The flat object reaches this matcher in either spelling — MovedDeclarations (encoder
 * Order 25, after Flatten's Order 2) splits the initialized declarator into `var flatObject;`
 * plus a separate assignment on roughly half of `high` runs — and a body-length test read
 * that as "not this pattern" rather than as the same wrapper spelled differently, declining
 * before any real matching. `resolveBindingValue` answers what the name holds regardless, and
 * fails closed on a binding written more than once, which is the property that matters: two
 * writes and the object handed to `flatFn` is not the one read here.
 *
 * The wrapper still has to do nothing but bind that object, so every statement ahead of the
 * `return` must be one of the binding's own — its declaration or its single write. That
 * replaces what the statement count used to guarantee.
 */
function matchWrapper(fnPath) {
  const node = fnPath.node
  if (!t.isBlockStatement(node.body)) return null
  if (node.params.length !== 1) return null
  const restParam = node.params[0]
  if (!t.isRestElement(restParam) || !t.isIdentifier(restParam.argument)) {
    return null
  }
  const argsName = restParam.argument.name

  const body = node.body.body
  if (body.length < 2) return null
  const retStmt = body[body.length - 1]
  if (!t.isReturnStatement(retStmt) || !t.isCallExpression(retStmt.argument)) {
    return null
  }
  const call = retStmt.argument
  if (
    !t.isIdentifier(call.callee) ||
    call.arguments.length !== 2 ||
    !t.isIdentifier(call.arguments[0]) ||
    !t.isIdentifier(call.arguments[1]) ||
    call.arguments[1].name !== argsName
  ) {
    return null
  }
  const flatObjectName = call.arguments[0].name

  const binding = fnPath.scope.getBinding(flatObjectName)
  if (!binding || binding.scope !== fnPath.scope) return null
  const value = resolveBindingValue(binding)
  if (!value || !t.isObjectExpression(value.node)) return null

  const ownStatements = new Set()
  const declStmt = binding.path.getStatementParent()
  if (declStmt) ownStatements.add(declStmt.node)
  for (const write of binding.constantViolations) {
    const writeStmt = write.getStatementParent()
    if (writeStmt) ownStatements.add(writeStmt.node)
  }
  for (const stmt of body.slice(0, -1)) {
    if (!ownStatements.has(stmt)) return null
  }

  const props = readFlatObjectProps(value.node)
  if (!props) return null

  return { newFnName: call.callee.name, props }
}

/**
 * Reads the flattened function's own parameter shape - either the normal
 * `(flatObject, [...origParams])` form, or (when the source file is strict mode,
 * where a non-simple parameter list can't follow a directive) the
 * `(){ var [flatObject, [...origParams]] = arguments; ... }` fallback.
 */
function extractGShape(gPath) {
  const params = gPath.node.params

  if (
    params.length === 2 &&
    t.isIdentifier(params[0]) &&
    t.isArrayPattern(params[1])
  ) {
    return {
      flatParamName: params[0].name,
      origParams: params[1].elements,
      prologue: false,
    }
  }

  if (params.length === 0) {
    const body = gPath.node.body.body
    const first = body[0]
    if (
      t.isVariableDeclaration(first) &&
      first.declarations.length === 1 &&
      t.isVariableDeclarator(first.declarations[0])
    ) {
      const declarator = first.declarations[0]
      if (
        t.isArrayPattern(declarator.id) &&
        declarator.id.elements.length === 2 &&
        t.isIdentifier(declarator.id.elements[0]) &&
        t.isArrayPattern(declarator.id.elements[1]) &&
        t.isIdentifier(declarator.init) &&
        declarator.init.name === 'arguments'
      ) {
        return {
          flatParamName: declarator.id.elements[0].name,
          origParams: declarator.id.elements[1].elements,
          prologue: true,
        }
      }
    }
  }

  return null
}

/**
 * True if `scope` is `ancestor` itself or nested inside it - used to tell "this name
 * resolves to a binding that lives inside the flattened function" (a real collision)
 * apart from "this name resolves to the legitimate outer binding sitting above it"
 * (fine, no rename needed), since both look identical as a bare name match.
 */
function isScopeWithin(scope, ancestor) {
  for (let s = scope; s; s = s.parent) {
    if (s === ancestor) return true
  }
  return false
}

/**
 * Replaces every `flatParam["prop"]` access inside the flattened function (params
 * included - default values can reference the flat object too) with the real
 * outer-scope reference the prop proxies to.
 *
 * `info.outerName` is spliced in as a bare identifier, so it only resolves correctly
 * if nothing inside the flattened function's own scope tree (its origParams, or any
 * local declared anywhere in its body, at any nesting depth) already binds that same
 * name - normally guaranteed by distinct source names, but `renameVariables` assigns
 * names independently per binding and can coincidentally hand the same string to an
 * outer free variable and one of this function's own locals. When that happens, the
 * colliding local is renamed out of the way first so the substituted reference still
 * resolves outward instead of being silently captured.
 */
function substituteFlatAccess(gPath, flatParamName, paramBinding, props) {
  gPath.traverse({
    MemberExpression(path) {
      const node = path.node
      if (
        !node.computed ||
        !t.isIdentifier(node.object) ||
        node.object.name !== flatParamName ||
        !t.isStringLiteral(node.property)
      ) {
        return
      }
      if (path.scope.getBinding(flatParamName) !== paramBinding) return

      const info = props.get(node.property.value)
      if (!info) return

      const shadow = path.scope.getBinding(info.outerName)
      if (shadow && isScopeWithin(shadow.scope, gPath.scope)) {
        shadow.scope.rename(info.outerName)
      }

      if (info.kind === 'typeof') {
        path.replaceWith(
          t.unaryExpression('typeof', t.identifier(info.outerName)),
        )
      } else {
        path.replaceWith(t.identifier(info.outerName))
      }
      path.skip()
    },
  })
}

/**
 * Inlines the flattened function's body back into the original function and drops
 * the now-dead flattened declaration. Nesting produces chains of this same wrapper
 * shape one level deeper (an inner function's severed reference to an even-more-
 * inner flattened function is itself proxied through the outer flat object) - each
 * successful inline can expose another one, so this recurses into the freshly
 * rebuilt body once it's done with the current level.
 *
 * Matches on `Function` (not just `FunctionDeclaration`): flattenFunction in
 * flatten.ts wraps FunctionDeclaration, FunctionExpression, and object/class
 * methods (kind "method") alike - only arrow functions are excluded encoder-side.
 */
const deFlatten = {
  // Sibling (non-nested) wrappers each crawl the program scope as they're
  // resolved, but a later sibling's crawl can still land on a stale view of an
  // earlier sibling's already-substituted body (observed with two independent
  // wrapper/flattened-function pairs referencing each other by call). One more
  // full crawl once every match in the program has been handled guarantees a
  // clean final state regardless of match order.
  Program: {
    exit(path) {
      path.scope.crawl()
    },
  },

  Function(fnPath) {
    if (fnPath.isArrowFunctionExpression()) return

    const wrapper = matchWrapper(fnPath)
    if (!wrapper) return

    // The flattened function itself arrives in either spelling: the CFF decode rebuilds it
    // as a declarator or an assignment rather than a `FunctionDeclaration` whenever it
    // swallowed it, and a `binding.path.isFunctionDeclaration()`
    // gate refused every one of those - 12 of 12 runs under `{ flatten, controlFlowFlattening }`,
    // with the wrapper above already matched. `resolveBindingFunction` reads what the binding
    // defines and is fail-closed on a second write, which is required here: the substitution
    // below rewrites this function's body into the wrapper, so a name holding something else
    // at some call site must not be taken.
    const binding = fnPath.scope.getBinding(wrapper.newFnName)
    if (!binding) return
    const gPath = resolveBindingFunction(binding)
    if (!gPath) return

    const shape = extractGShape(gPath)
    if (!shape) return

    const paramBinding = gPath.scope.getBinding(shape.flatParamName)
    if (!paramBinding) return

    substituteFlatAccess(
      gPath,
      shape.flatParamName,
      paramBinding,
      wrapper.props,
    )

    const bodyStatements = shape.prologue
      ? gPath.node.body.body.slice(1)
      : gPath.node.body.body

    // Clone rather than reuse: gPath still owns these nodes until it's deleted
    // below, and leaving fnPath's new body/params aliasing the same node objects
    // makes them reachable via two paths at once, so a later scope crawl walks
    // (and double-counts) them twice.
    fnPath.node.params = shape.origParams.map((n) => t.cloneNode(n, true))
    fnPath.node.body = t.blockStatement(
      bodyStatements.map((n) => t.cloneNode(n, true)),
    )

    // safeDeleteNode crawls to check newFnName's own reference count, but that
    // crawl happens while gPath (with its own, not-yet-discarded copy of the
    // substituted body) is still physically in the tree - it leaves other
    // bindings (e.g. the outer-scope names we just substituted in) stale by
    // double-counting them. Only a fresh crawl taken after gPath is actually
    // removed reflects the real, final tree.
    safeDeleteNode(wrapper.newFnName, binding.path)
    fnPath.scope.getProgramParent().crawl()

    fnPath.traverse(deFlatten)
    fnPath.skip()
  },
}

export default deFlatten
