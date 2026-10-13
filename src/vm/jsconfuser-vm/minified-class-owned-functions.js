import { decline, propertyName } from './container-role-helpers.js'
import {
  clauseLiveness,
  compatibleRoleBindings,
} from './minified-class-binding-liveness.js'
import {
  semanticClause,
  semanticShape,
  tryClause,
} from './minified-class-semantic-clauses.js'

const closed = (ok, role) => {
  if (!ok) decline('minified-class-functions', role)
}
export function inert(node, context, parameters = new Set()) {
  if (!node) return false
  if (
    [
      'NumericLiteral',
      'StringLiteral',
      'BooleanLiteral',
      'NullLiteral',
    ].includes(node.type)
  )
    return true
  if (node.type === 'ThisExpression') return false
  if (node.type === 'Identifier')
    return (
      parameters.has(context.bindingFor(node)) ||
      (node.name === 'undefined' && !context.bindingFor(node))
    )
  if (
    node.type === 'UnaryExpression' &&
    node.operator === 'void' &&
    node.argument.type === 'NumericLiteral' &&
    node.argument.value === 0
  )
    return true
  if (node.type === 'ArrayExpression')
    return node.elements.every((n) => inert(n, context, parameters))
  if (node.type === 'ObjectExpression') return node.properties.length === 0
  if (node.type === 'LogicalExpression')
    return (
      inert(node.left, context, parameters) &&
      inert(node.right, context, parameters)
    )
  return false
}
function methodIdentity(context, fn) {
  const assignment = context.paths.get(fn).parentPath?.node
  const left = assignment?.left
  if (
    assignment?.type !== 'AssignmentExpression' ||
    assignment.operator !== '=' ||
    left?.type !== 'MemberExpression' ||
    left.computed ||
    left.object?.type !== 'MemberExpression' ||
    left.object.computed ||
    propertyName(left.object.property) !== 'prototype'
  )
    return null
  const owner = context.bindingFor(left.object.object)
  return owner ? { owner, name: propertyName(left.property), assignment } : null
}

export function ownedFunctions(context, boot) {
  const functions = context
    .nodes(context.program)
    .filter(
      ({ node, path }) =>
        (node.type === 'FunctionDeclaration' && path.parentPath.isProgram()) ||
        (node.type === 'FunctionExpression' &&
          path.parentPath.isAssignmentExpression() &&
          path.parentPath.parentPath.isExpressionStatement() &&
          path.parentPath.parentPath.parentPath.isProgram()),
    )
    .map(({ node }) => ({
      fn: node,
      method: methodIdentity(context, node),
      binding: node.id && context.bindingFor(node.id),
    }))
  const writesOnly = new Set()
  const members = new Map()
  for (const { node, path } of context.nodes(context.program)) {
    if (node.type === 'ObjectProperty' && !node.computed) {
      const name = propertyName(node.key)
      if (!members.has(name)) members.set(name, [])
      members.get(name).push({ node, path })
      continue
    }
    if (
      node.type !== 'MemberExpression' ||
      (node.computed && node.property.type !== 'StringLiteral')
    )
      continue
    const name = propertyName(node.property)
    if (!members.has(name)) members.set(name, [])
    members.get(name).push({ node, path })
  }
  for (const [name, uses] of members) {
    if (['prototype', '__proto__', 'constructor', 'length'].includes(name))
      continue
    if (
      uses.every(
        ({ node, path }) =>
          path.parentPath.isAssignmentExpression({ operator: '=' }) &&
          path.parentPath.node.left === node,
      )
    )
      writesOnly.add(name)
  }
  const effects = []
  const strips = new Map()
  function stripped(entry) {
    if (strips.has(entry.fn)) return strips.get(entry.fn)
    const parameters = new Set(
      entry.fn.params.map((p) => context.bindingFor(p)),
    )
    const body = semanticShape(entry.fn.body)
    const removed = new Set()
    function strip(items) {
      return items
        .filter((statement) => {
          const left = statement.left
          if (
            statement.type !== 'AssignmentExpression' ||
            statement.operator !== '=' ||
            left?.type !== 'MemberExpression' ||
            left.computed ||
            !writesOnly.has(propertyName(left.property)) ||
            !inert(statement.right, context, parameters)
          )
            return true
          removed.add(propertyName(left.property))
          effects.push({
            functionNode: entry.fn,
            field: propertyName(left.property),
            value: statement.right,
            receiver: left.object,
          })
          return false
        })
        .map((statement) => {
          if (!statement || typeof statement !== 'object') return statement
          return Object.fromEntries(
            Object.entries(statement).map(([key, value]) => [
              key,
              ['body', 'consequent', 'alternate'].includes(key) &&
              Array.isArray(value)
                ? strip(value)
                : value,
            ]),
          )
        })
    }
    const retained = strip(body)
    const result = { body: retained, removed }
    strips.set(entry.fn, result)
    return result
  }
  const calls = new Map()
  const roles = new Map()
  const records = new Map()
  const canonicalParams = {
    pushFrame: ['vm', 'closure', 'args', 'thisValue', 'retDst'],
    capture: ['vm', 'fp', 'slot'],
    closeFrame: ['vm', 'fp'],
    closeUpvalue: ['uv'],
    readUpvalue: ['uv'],
    writeUpvalue: ['uv', 'value'],
    Closure: ['descriptor'],
    Upvalue: ['uvRegs', 'abs'],
    VM: ['words', 'pool', 'globals'],
  }
  function register(role, entry, local, params, construct = false) {
    closed(!records.has(role), `${role}: owned function is ambiguous`)
    const parameterBindings = entry.fn.params.map((p) => context.bindingFor(p))
    closed(
      parameterBindings.every(Boolean) &&
        new Set(parameterBindings).size === parameterBindings.length,
      `${role}: parameter identities overlap`,
    )
    const indexes = params.map((name) =>
      local.get(name) === 'this' && entry.method
        ? -1
        : parameterBindings.indexOf(local.get(name)),
    )
    closed(
      indexes.every(
        (index, i) =>
          index >= 0 || (local.get(params[i]) === 'this' && entry.method),
      ) && new Set(indexes).size === indexes.length,
      `${role}: real parameter roles are disconnected`,
    )
    const real = new Set(indexes)
    const fake = new Set(parameterBindings.filter((_, i) => !real.has(i)))
    const incoming = clauseLiveness(entry.retained, (node) =>
      context.bindingFor(node),
    )
    for (const binding of parameterBindings.filter((_, i) => !real.has(i))) {
      closed(
        !incoming.has(binding),
        `${role}: dummy parameter affects retained logic`,
      )
    }
    const call = {
      argumentsFor(actual) {
        const expectedType = construct ? 'NewExpression' : 'CallExpression'
        if (actual?.type !== expectedType) return null
        let receiver = null
        if (entry.method) {
          const member = actual.callee
          if (
            member?.type !== 'MemberExpression' ||
            member.computed ||
            propertyName(member.property) !== entry.method.name
          )
            return null
          receiver = member.object
        } else if (context.bindingFor(actual.callee) !== entry.binding)
          return null
        const args = actual.arguments
        if (role !== 'run' && indexes.some((index) => index >= args.length))
          return null
        if (args.some((arg, index) => !real.has(index) && !inert(arg, context)))
          return null
        return indexes.map((index) =>
          index === -1
            ? receiver
            : (args[index] ?? {
                type: 'UnaryExpression',
                operator: 'void',
                prefix: true,
                argument: { type: 'NumericLiteral', value: 0 },
              }),
        )
      },
      entry,
      indexes,
      params,
      local,
    }
    records.set(role, call)
    calls.set(role, call)
    call.fake = fake
    return call
  }
  function identify(
    role,
    sources,
    shared,
    params = canonicalParams[role],
    construct = false,
    optional = false,
  ) {
    const candidates = []
    for (const entry of functions) {
      if (
        records.size &&
        [...records.values()].some((r) => r.entry.fn === entry.fn)
      )
        continue
      const { body } = stripped(entry)
      for (const source of sources) {
        const vm = entry.method
          ? 'this'
          : context.bindingFor(entry.fn.params[0])
        const local = new Map([...roles, ...shared, ['vm', vm]])
        if (['readUpvalue', 'writeUpvalue', 'closeUpvalue'].includes(role))
          local.set('uv', vm)
        const found = tryClause(
          semanticClause(source),
          body,
          context,
          local,
          calls,
        )
        if (found && compatibleRoleBindings(semanticClause(source), found)) {
          candidates.push({ entry: { ...entry, retained: body }, local: found })
          break
        }
      }
    }
    if (optional && candidates.length === 0) return null
    closed(
      candidates.length === 1,
      `${role}: complete owned body is ${candidates.length ? 'ambiguous' : 'missing or changed'}`,
    )
    const { entry, local } = candidates[0]
    for (const [name, value] of local)
      if (name.endsWith('Field')) {
        closed(
          !roles.has(name) || roles.get(name) === value,
          `${role}: shared field identity changed`,
        )
        roles.set(name, value)
      }
    return register(role, entry, local, params, construct)
  }
  return {
    functions,
    writesOnly,
    effects,
    calls,
    roles,
    records,
    identify,
    register,
    stripped,
    boot,
  }
}

export const OWNED_CLAUSES = {
  bytes: [
    'return typeof Buffer!=="undefined"?Buffer.from($value,"base64"):Uint8Array.from(atob($value),function($char){return $char.charCodeAt(0)});',
  ],
  pushFrame: [
    `$descriptor=$closure.$descriptorField;$regs=$vm.$regsField;$fp=$vm.$topField;$size=8+$descriptor.$countField;$end=$fp+$size;
    for(;$regs.length<$end;)$regs.push(void 0);for($counter=$fp;$counter<$end;$counter++)$regs[$counter]=void 0;
    $base=$fp+8;$regs[$fp+0]=$descriptor.$startField;$regs[$fp+1]=$vm.$frameField;$regs[$fp+2]=$retDst;$regs[$fp+3]=$thisValue;$regs[$fp+4]=$closure;$regs[$fp+6]=$size;$regs[$fp+7]=$base;$vm.$topField=$end;
    if($args){if($descriptor.$restField){$limit=$descriptor.$paramField-1;for($argCounter=0;$argCounter<$limit;$argCounter++)$regs[$base+$argCounter]=$argCounter<$args.length?$args[$argCounter]:void 0;$regs[$base+$limit]=$args.slice($limit);}else for($limit=0;$limit<$args.length&&$limit<$descriptor.$countField;$limit++)$regs[$base+$limit]=$args[$limit];$descriptor.$paramField<$descriptor.$countField&&($regs[$base+$descriptor.$paramField]=$args);}$vm.$frameField=$fp;`,
  ],
  capture: [
    `$abs=$vm.$regsField[$fp+7]+$slot;$table=$vm.$openField||($vm.$openField=[]);return $table[$abs]||($table[$abs]=$Upvalue($vm.$regsField,$abs));`,
  ],
  closeFrame: [
    `$table=$vm.$openField;if($table){$regs=$vm.$regsField;$hi=$fp+$regs[$fp+6];for($counter=$regs[$fp+7];$counter<$hi;$counter++)if($uv=$table[$counter]){$uv.$valueField=$uv.$uvRegsField[$uv.$absField];$uv.$closedField=!0;$table[$counter]=void 0;}}`,
    `$table=$vm.$openField;if($table){$regs=$vm.$regsField;$hi=$fp+$regs[$fp+6];for($counter=$regs[$fp+7];$counter<$hi;$counter++)if($uv=$table[$counter]){$closeUpvalue($uv);$table[$counter]=void 0;}}`,
  ],
  closeUpvalue: [
    '$uv.$valueField=$uv.$uvRegsField[$uv.$absField];$uv.$closedField=!0;',
  ],
  readUpvalue: [
    'return $uv.$closedField?$uv.$valueField:$uv.$uvRegsField[$uv.$absField];',
  ],
  writeUpvalue: [
    '$uv.$closedField?$uv.$valueField=$value:$uv.$uvRegsField[$uv.$absField]=$value;',
  ],
}
