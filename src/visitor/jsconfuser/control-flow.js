import * as t from '@babel/types'
import logger from '../../utility/logger.js'
const debugLog = logger.debugLog
import safeFunc from '../../utility/safe-func.js'
const safeGetLiteral = safeFunc.safeGetLiteral
const safeGetName = safeFunc.safeGetName
const safeReplace = safeFunc.safeReplace

function checkControlVar(path) {
  const parent = path.parentPath
  if (path.key !== 'right' || !parent.isAssignmentExpression()) {
    return false
  }
  const var_path = parent.get('left')
  const var_name = var_path.node?.name
  if (!var_name) {
    return false
  }
  let root_path = parent.parentPath
  if (root_path.isExpressionStatement) {
    root_path = root_path.parentPath
  }
  // `getBinding` returns undefined for an assignment to a name with no declaration in
  // scope - an implicit global, or a leftover reference in a scope that hasn't been
  // re-crawled since an earlier pass rewrote it. Neither is the controlVar shape this
  // matcher is looking for, so fail closed instead of dereferencing undefined.
  const binding = parent.scope.getBinding(var_name)
  if (!binding) {
    return false
  }
  for (const ref of binding.referencePaths) {
    if (ref === var_path) {
      continue
    }
    let cur = ref
    let valid = false
    while (cur && cur !== root_path) {
      if (cur.isSwitchCase() || cur === path) {
        valid = true
        break
      }
      cur = cur.parentPath
    }
    if (!valid) {
      return false
    }
    if (ref.key === 'object') {
      const prop = ref.parentPath.get('property')
      if (!prop.isLiteral() && !prop.isIdentifier()) {
        return false
      }
      continue
    }
    if (ref.key === 'right') {
      const left = ref.parentPath.get('left')
      if (!left.isMemberExpression()) {
        return false
      }
      const obj = safeGetName(left.get('object'))
      if (obj !== var_name) {
        return false
      }
      continue
    }
  }
  return true
}

/**
 * Process the constant properties in the controlVar
 *
 * Template:
 * ```javascript
 * controlVar = {
 *   // strings
 *   key_string: 'StringLiteral',
 *   // numbers
 *   key_number: 'NumericLiteral',
 * }
 * ```
 *
 * Some kinds of deadCode may in inserted to the fake chunks:
 *
 * ```javascript
 * controlVar = false
 * controlVar = undefined
 * controlVar[randomControlKey] = undefined
 * delete controlVar[randomControlKey]
 * ```
 */
const deControlFlowFlatteningStateless = {
  ObjectExpression(path) {
    if (!checkControlVar(path)) {
      return
    }
    const parent = path.parentPath
    const var_name = parent.get('left').node?.name
    debugLog(`[ControlFlowFlattening] parse stateless in obj: ${var_name}`)
    const props = {}
    const prop_num = path.node.properties.length
    for (let i = 0; i < prop_num; ++i) {
      const prop = path.get(`properties.${i}`)
      const key = safeGetName(prop.get('key'))
      const value = safeGetLiteral(prop.get('value'))
      if (!key || !value) {
        continue
      }
      props[key] = value
    }
    const binding = parent.scope.getBinding(var_name)
    for (const ref of binding.referencePaths) {
      if (ref.key !== 'object') {
        continue
      }
      const prop = safeGetName(ref.parentPath.get('property'))
      if (!prop) {
        continue
      }
      if (!Object.prototype.hasOwnProperty.call(props, prop)) {
        continue
      }
      const upper = ref.parentPath
      if (upper.key === 'left' && upper.parentPath.isAssignmentExpression()) {
        // this is in the fake chunk
        ref.parentPath.parentPath.remove()
        continue
      }
      safeReplace(ref.parentPath, props[prop])
    }
    binding.scope.crawl()
  },
}

/**
 *
 * Template:
 * ```javascript
 * flaggedLabels = {
 *   currentLabel: { flagKey: 'xxx', flagValue : 'true or false' }
 * }
 * labelToStates[chunk[i].label] = stateValues: [] => caseStates[i]
 * initStateValues = labelToStates[startLabel]
 * endState
 * chunks = [
 *   {
 *     body: [
 *       {
 *         type: "GotoStatement",
 *         label: "END_LABEL",
 *       }
 *     ],
 *   }
 *   {
 *     label: "END_LABEL",
 *     body: [],
 *   }
 * ]
 * while (stateVars) {
 *   switch (stateVars) {
 *     // fake assignment expression
 *     case fake_assignment: {
 *       stateVar = 'rand'
 *       // 'GotoStatement label'
 *     }
 *     // clone chunks
 *     case fake_clone: {
 *       // contain a real chunk
 *     }
 *     // fake jumps
 *     case real_1: {
 *       if (false) {
 *         // 'GotoStatement label'
 *       }
 *       // follow with real statements
 *     }
 *   }
 * }
 * The key may exist in its parent's map
 * ```
 */
const deControlFlowFlatteningState = {
  ObjectExpression(path) {
    if (!checkControlVar(path)) {
      return
    }
  },
}

/**
 * Undoes ControlFlowFlattening's literal entanglement: every mangled
 * number/boolean/string is a small arithmetic expression whose only "variable" is
 * `statesName[index]` - a member read off the state-vector array - combined with plain
 * constants. Given the concrete value each `states[i]` slot holds AT A SPECIFIC BLOCK
 * (`stateValues` below), decoding a mangled literal is just evaluating that arithmetic.
 * Deliberately standalone/unwired: it only needs a block's already-known state vector as
 * input, not the graph-resolution logic that produces one, so it stays independently
 * testable. `control-flow-graph.js`'s `undoLiteralEntanglementInGraph` is what supplies
 * those vectors across a whole resolved block graph.
 *
 * `index` itself can recurse: dead-code guard predicates are spliced in before Stage 2
 * runs, so their own `states[i]` reads get swept up by the very same generic mangling
 * pass Stage 2 applies to everything else, and can come out as `states[j] + k` instead of
 * a plain integer. resolveStateNumber handles that for free, by recursing through
 * MemberExpression the same way as any other operand.
 *
 * Numeric-literal mangling only ever wraps in `+` at the top level (see
 * controlFlowFlattening.ts's `diff` construction, always `t.binaryExpression("+", ...)`);
 * `-` only shows up in the state-transition-diff and Stage-3 complex-test shapes, which
 * belong to the transition-graph problem, not literal decoding, so the auto-replacing
 * visitor below only ever fires on `+`. resolveStateNumber itself still evaluates `-`
 * too, since transition-diff/complex-test resolution can reuse the exact same "arithmetic
 * over a known state vector" evaluator later.
 */

function containsStateRef(path, statesName) {
  if (
    path.isMemberExpression({ computed: true }) &&
    path.get('object').isIdentifier({ name: statesName })
  ) {
    return true
  }
  if (path.isBinaryExpression()) {
    return (
      containsStateRef(path.get('left'), statesName) ||
      containsStateRef(path.get('right'), statesName)
    )
  }
  if (path.isUnaryExpression()) {
    return containsStateRef(path.get('argument'), statesName)
  }
  return false
}

function resolveStateNumber(path, statesName, stateValues) {
  if (path.isNumericLiteral()) {
    return path.node.value
  }
  if (path.isUnaryExpression({ operator: '-' })) {
    const value = resolveStateNumber(
      path.get('argument'),
      statesName,
      stateValues,
    )
    return value === null ? null : -value
  }
  if (
    path.isBinaryExpression() &&
    (path.node.operator === '+' || path.node.operator === '-')
  ) {
    const left = resolveStateNumber(path.get('left'), statesName, stateValues)
    const right = resolveStateNumber(path.get('right'), statesName, stateValues)
    if (left === null || right === null) {
      return null
    }
    return path.node.operator === '+' ? left + right : left - right
  }
  if (
    path.isMemberExpression({ computed: true }) &&
    path.get('object').isIdentifier({ name: statesName })
  ) {
    const index = resolveStateNumber(
      path.get('property'),
      statesName,
      stateValues,
    )
    if (
      index === null ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= stateValues.length
    ) {
      return null
    }
    return stateValues[index]
  }
  return null
}

function resolveStateBoolean(path, statesName, stateValues) {
  if (!path.isBinaryExpression()) {
    return null
  }
  const { operator } = path.node
  if (operator !== '==' && operator !== '!=') {
    return null
  }
  if (!containsStateRef(path, statesName)) {
    return null
  }
  const left = resolveStateNumber(path.get('left'), statesName, stateValues)
  const right = resolveStateNumber(path.get('right'), statesName, stateValues)
  if (left === null || right === null) {
    return null
  }
  const equal = left === right
  return operator === '==' ? equal : !equal
}

// Mirrors encoder/js-confuser's templates/xorStringTemplate.ts `xorDecodeString` exactly:
// a position-based stream cipher where the key is re-derived from itself each character.
function xorDecodeString(str, key) {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    key = (key + 0x9e3779b9) | 0
    const ks = (((key ^ (key >>> 13)) % 95) + 95) % 95
    const normalized = str.charCodeAt(i) - 32
    const shifted = (((normalized - ks) % 95) + 95) % 95
    result += String.fromCharCode(shifted + 32)
  }
  return result
}

function resolveStateString(
  path,
  statesName,
  stateValues,
  xorFnName,
  stringsBlob,
) {
  if (!path.isCallExpression()) {
    return null
  }
  if (!path.get('callee').isIdentifier({ name: xorFnName })) {
    return null
  }
  const args = path.get('arguments')
  if (args.length !== 3) {
    return null
  }
  const key = resolveStateNumber(args[0], statesName, stateValues)
  const start = resolveStateNumber(args[1], statesName, stateValues)
  const length = resolveStateNumber(args[2], statesName, stateValues)
  if (key === null || start === null || length === null) {
    return null
  }
  if (start < 0 || length < 0 || start + length > stringsBlob.length) {
    return null
  }
  return xorDecodeString(stringsBlob.slice(start, start + length), key)
}

function numericLiteralNode(value) {
  return value < 0
    ? t.unaryExpression('-', t.numericLiteral(-value))
    : t.numericLiteral(value)
}

/**
 * Builds a visitor that undoes all three literal-entanglement shapes for one flattened
 * function/program, given its per-block-resolved state vector. `xorFnName`/`stringsBlob`
 * are optional - omit them (or leave a call unmatched) to only undo numbers/booleans.
 */
function makeLiteralResolverVisitor({
  statesName,
  stateValues,
  xorFnName,
  stringsBlob,
}) {
  return {
    BinaryExpression(path) {
      if (path.node.operator === '==' || path.node.operator === '!=') {
        const bool = resolveStateBoolean(path, statesName, stateValues)
        if (bool !== null) {
          path.replaceWith(t.booleanLiteral(bool))
          path.skip()
        }
        return
      }
      if (path.node.operator === '+') {
        if (!containsStateRef(path, statesName)) {
          return
        }
        const num = resolveStateNumber(path, statesName, stateValues)
        if (num !== null) {
          path.replaceWith(numericLiteralNode(num))
          path.skip()
        }
      }
    },
    CallExpression(path) {
      if (!xorFnName || !stringsBlob) {
        return
      }
      const str = resolveStateString(
        path,
        statesName,
        stateValues,
        xorFnName,
        stringsBlob,
      )
      if (str !== null) {
        path.replaceWith(t.stringLiteral(str))
        path.skip()
      }
    },
  }
}

export default {
  deControlFlowFlatteningStateless,
  deControlFlowFlatteningState,
  resolveStateNumber,
  resolveStateBoolean,
  resolveStateString,
  xorDecodeString,
  makeLiteralResolverVisitor,
}
