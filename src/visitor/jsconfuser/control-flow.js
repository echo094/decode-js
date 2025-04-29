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
  const binding = parent.scope.getBinding(var_name)
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
    console.log(`[ControlFlowFlattening] parse stateless in obj: ${var_name}`)
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

export default {
  deControlFlowFlatteningStateless,
  deControlFlowFlatteningState,
}
