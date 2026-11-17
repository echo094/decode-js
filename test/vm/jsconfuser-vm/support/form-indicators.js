import { parse } from '@babel/parser'
import * as t from '@babel/types'

// Form indicators of one program, compared between a source and its decode: a cell suite names, per
// program, the indicators its decode must share with the source (M1, M2).

const parserOptions = {
  allowReturnOutsideFunction: true,
  errorRecovery: false,
  sourceType: 'script',
}

function walk(node, visit, seen = new Set()) {
  if (!node || typeof node.type !== 'string' || seen.has(node)) return
  seen.add(node)
  visit(node)
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, seen)
    } else {
      walk(value, visit, seen)
    }
  }
}

function assignmentParts(statement) {
  const expression = statement?.expression
  if (
    statement?.type !== 'ExpressionStatement' ||
    expression?.type !== 'AssignmentExpression' ||
    expression.operator !== '=' ||
    expression.left?.type !== 'Identifier'
  )
    return null
  return {
    destination: expression.left.name,
    source:
      expression.right?.type === 'Identifier' ? expression.right.name : null,
  }
}

function adjacentIdentifierCopies(ast) {
  let copies = 0
  walk(ast, (node) => {
    // A for-in head writes its key, so a body opening with a move of the key is a copy.
    if (node.type === 'ForInStatement') {
      const first =
        node.body.type === 'BlockStatement' ? node.body.body[0] : node.body
      if (
        node.left.type === 'Identifier' &&
        assignmentParts(first)?.source === node.left.name
      )
        copies += 1
      return
    }
    if (!['Program', 'BlockStatement'].includes(node.type)) return
    for (let index = 0; index + 1 < node.body.length; index += 1) {
      const producer = assignmentParts(node.body[index])
      const move = assignmentParts(node.body[index + 1])
      if (producer?.destination && producer.destination === move?.source)
        copies += 1
    }
  })
  return copies
}

// The properties object literals write (data, method, accessor or spread), of them the native
// getters and setters, and the conditional expressions written.
function objectLiteralForms(ast) {
  let objectProperties = 0
  let accessors = 0
  let conditionals = 0
  let logicals = 0
  walk(ast, (node) => {
    if (node.type === 'ConditionalExpression') conditionals += 1
    if (node.type === 'LogicalExpression') logicals += 1
    if (node.type !== 'ObjectExpression') return
    objectProperties += node.properties.length
    accessors += node.properties.filter(
      (property) =>
        property.type === 'ObjectMethod' &&
        ['get', 'set'].includes(property.kind),
    ).length
  })
  return { objectProperties, accessors, conditionals, logicals }
}

// The host-access forms a sloppy program writes natively: calls through a member (`o.m()`,
// `o[k]()`; a `Reflect` call is the decode's spelling of a call, not one of them), assignments to a
// member (`o.k = v`, `o[k] += v`), and references to `globalThis`, which a source reaches through a
// bare name.
function hostAccessForms(ast) {
  let methodCalls = 0
  let memberAssignments = 0
  let globalThisReferences = 0
  walk(ast, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      !(
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'Reflect'
      )
    )
      methodCalls += 1
    if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'MemberExpression'
    )
      memberAssignments += 1
    if (node.type === 'Identifier' && node.name === 'globalThis')
      globalThisReferences += 1
  })
  return { methodCalls, memberAssignments, globalThisReferences }
}

// The statement forms a decode writes back as the source has them, and the parameters its
// functions declare.
function statementForms(ast) {
  const forms = {
    parameters: 0,
    ifs: 0,
    loops: 0,
    forIns: 0,
    switches: 0,
    labels: 0,
  }
  walk(ast, (node) => {
    if (node.params) forms.parameters += node.params.length
    if (node.type === 'IfStatement') forms.ifs += 1
    if (
      ['ForStatement', 'WhileStatement', 'DoWhileStatement'].includes(node.type)
    )
      forms.loops += 1
    if (node.type === 'ForInStatement') forms.forIns += 1
    if (node.type === 'SwitchStatement') forms.switches += 1
    if (node.type === 'LabeledStatement') forms.labels += 1
  })
  return forms
}

// Scaffolding is the decode's own machinery for a call or a closure: capture cells, captured
// registers, wrapped arguments and receivers, and the for-in enumeration helper. A source has none.
const scaffoldingName =
  /^__recovered_(?:cells_|captures|closure_captures_|closure_args|args|this|enumerable_keys)/
function scaffolding(ast) {
  let count = 0
  walk(ast, (node) => {
    if (node.type === 'Identifier' && scaffoldingName.test(node.name))
      count += 1
  })
  return count
}

// Adjacent copies are a producer's value moved into another variable by the next statement;
// object properties and accessors are what object literals write; conditionals the
// `test ? a : b` expressions, logicals the `a && b`, `a || b` and `a ?? b` ones; then the host
// access forms, the statement forms and the scaffolding above.
export function formIndicators(code) {
  const ast = parse(code, parserOptions)
  return {
    copies: adjacentIdentifierCopies(ast),
    ...objectLiteralForms(ast),
    ...hostAccessForms(ast),
    ...statementForms(ast),
    scaffolding: scaffolding(ast),
  }
}
