import { parse } from '@babel/parser'
import { normalizeStatements } from './locate-handlers.js'
import { CANONICAL_OPCODES } from './opcode-table.js'
import { HANDLER_MATCHERS, isDispatchRole } from './handler-matchers.js'
import { handlerEffects, templateEffects } from './handler-effects.js'

// Runtime meaning: an opcode is what its handler does, never its label or its spelling. A handler's
// effects (handler-effects.js) are compared with each canonical opcode's reference effects,
// evaluated from its catalogue template, and only when a stage needs its opcode. The spread
// sentinel is the value CALL compares its argument count with.

function withoutBreaks(statements) {
  return statements.filter(
    (statement) =>
      statement.type !== 'BreakStatement' &&
      statement.type !== 'EmptyStatement',
  )
}

function templateStatements(source) {
  const program = parse(
    `function template(){while(true){switch(0){case 0:${source}}}}`,
  ).program
  const statements =
    program.body[0].body.body[0].body.body[0].cases[0].consequent
  return withoutBreaks(normalizeStatements(statements))
}

const REFERENCES = HANDLER_MATCHERS.map(({ name, source }) => ({
  name,
  ...templateEffects(templateStatements(source)),
}))

// Fitting binds `$name` roles. Dispatch roles live in `roles.dispatch` for every handler, and no
// two of them share a value; the others live in `roles.local` for this handler only, and may share
// one, since minify keeps several of a handler's values in one variable.
function bind(roles, name, value) {
  const dispatch = isDispatchRole(name)
  const table = dispatch ? roles.dispatch : roles.local
  if (table.has(name)) return table.get(name) === value
  if (dispatch)
    for (const bound of table.values()) if (bound === value) return false
  table.set(name, value)
  return true
}

const isObject = (term) =>
  term !== null && typeof term === 'object' && !Array.isArray(term)
const isPropertyRole = (term) =>
  isObject(term) &&
  Object.keys(term).length === 1 &&
  typeof term.name === 'string' &&
  term.name.startsWith('$')
const isRole = (term) =>
  isObject(term) && Object.keys(term).length === 1 && 'role' in term

// A call to an interpreter helper or constructor (`$pushFrame(...)`, `$vm.$pushFrameMethod(...)`,
// `new $Closure(...)`). Class obfuscation turns a VM method into a function taking the VM first and
// permutes helper parameters, so a helper call is its callee and an unordered list of arguments,
// a method call's receiver among them.
function helperCall(term, reference) {
  if (!isObject(term)) return null
  const kind = 'call' in term ? 'call' : 'new' in term ? 'new' : null
  if (!kind || Object.keys(term).length !== 2) return null
  const callee = term[kind]
  const method =
    kind === 'call' &&
    isObject(callee) &&
    Array.isArray(callee.get) &&
    isObject(callee.get[1]) &&
    typeof callee.get[1].name === 'string'
  if (reference) {
    const helper = method
      ? isPropertyRole(callee.get[1])
      : isRole(callee) &&
        isDispatchRole(callee.role) &&
        !callee.role.startsWith('_')
    if (!helper) return null
  }
  return method
    ? { kind, callee: callee.get[1], args: [callee.get[0], ...term.args] }
    : { kind, callee, args: term.args }
}

// Arguments left over must be dummy literals: minify can leave a decoy argument whose field the
// decoy test cannot single out.
const isDummy = (term) =>
  isObject(term) &&
  (('literal' in term && Object.keys(term).length === 1) ||
    term.undefined === true ||
    (Array.isArray(term.array) && term.array.length === 0) ||
    (Array.isArray(term.object) && term.object.length === 0))

// Whether the actual effects do what the reference effects do: the same terms, each operand slot
// in the same position, each role bound to one actual term.
function fit(reference, actual, roles) {
  if (Array.isArray(reference))
    return (
      Array.isArray(actual) &&
      reference.length === actual.length &&
      reference.every((item, index) => fit(item, actual[index], roles))
    )
  if (!isObject(reference)) return reference === actual
  if (!isObject(actual)) return false
  if (isRole(reference)) {
    const name = reference.role
    // `$_ROLE` is a number: a frame-header offset or the spread sentinel.
    if (name.startsWith('_'))
      return (
        Object.keys(actual).length === 1 &&
        typeof actual.literal === 'number' &&
        bind(roles, name, actual.literal)
      )
    return bind(roles, name, JSON.stringify(actual))
  }
  if (isPropertyRole(reference))
    return (
      Object.keys(actual).length === 1 &&
      typeof actual.name === 'string' &&
      bind(roles, reference.name.slice(1), `property:${actual.name}`)
    )
  const helper = helperCall(reference, true)
  if (helper) {
    const call = helperCall(actual, false)
    return (
      Boolean(call) &&
      call.kind === helper.kind &&
      fitCallee(helper.callee, call.callee, roles) &&
      unordered(helper.args, call.args, roles)
    )
  }
  const keys = Object.keys(reference).sort()
  const actualKeys = Object.keys(actual).sort()
  return (
    keys.length === actualKeys.length &&
    keys.every(
      (key, index) =>
        key === actualKeys[index] && fit(reference[key], actual[key], roles),
    )
  )
}

// A helper's role names whatever the runtime calls: a method's property name, or the function
// class obfuscation made of it.
function fitCallee(reference, actual, roles) {
  if (!isPropertyRole(reference) || !isObject(actual))
    return fit(reference, actual, roles)
  const value =
    Object.keys(actual).length === 1 && typeof actual.name === 'string'
      ? `property:${actual.name}`
      : JSON.stringify(actual)
  return bind(roles, reference.name.slice(1), value)
}

function unordered(references, actuals, roles) {
  if (references.length > actuals.length) return false
  const assign = (index, used) => {
    if (index === references.length)
      return actuals.every(
        (term, position) => used.has(position) || isDummy(term),
      )
    for (let candidate = 0; candidate < actuals.length; candidate++) {
      if (used.has(candidate)) continue
      const trial = {
        dispatch: new Map(roles.dispatch),
        local: new Map(roles.local),
      }
      if (!fit(references[index], actuals[candidate], trial)) continue
      used.add(candidate)
      if (assign(index + 1, used)) {
        roles.dispatch = trial.dispatch
        roles.local = trial.local
        return true
      }
      used.delete(candidate)
    }
    return false
  }
  return assign(0, new Set())
}

// The meaning of a handler is found when a stage needs it. `opcodeFor(label)` names the opcode
// whose references fit the handler with that label, provided exactly one opcode fits it and that
// opcode's references fit no other handler; otherwise null (the decode's default stays). Matches
// bind the dispatch roles they commit to for every later question.
export function meaningResolver(view) {
  // One identity per binding across the runtime, so a dispatch role binds the same term in every
  // handler.
  const identities = new Map()
  const bodies = new Map(
    view.handlers.map((handler) => [
      handler.label,
      { handler, ...handlerEffects(view, handler, identities) },
    ]),
  )
  // The locator already knows the payload fields from the VM construction.
  const dispatch = new Map([
    ['wordsField', `property:${view.fields.words}`],
    ['poolField', `property:${view.fields.pool}`],
  ])
  // Dispatch roles only grow and every role constrains a match, so a template that failed to fit
  // a handler still fails later; such misses are remembered.
  const misses = new Set()
  const fits = (name, body) => {
    const key = `${name}:${body.handler.label}`
    if (misses.has(key)) return null
    const roles = fitsNow(name, body)
    if (!roles) misses.add(key)
    return roles
  }
  const fitsNow = (name, body) => {
    for (const reference of REFERENCES) {
      if (reference.name !== name || reference.operands !== body.operands)
        continue
      const roles = { dispatch: new Map(dispatch), local: new Map() }
      if (fit(reference.effects, body.effects, roles)) return roles
    }
    return null
  }
  const answers = new Map()
  // The one opcode whose template fits the handler at `label` and no other handler of `among`.
  const nameAmong = (label, among) => {
    const body = bodies.get(label)
    if (!body) return null
    const names = Object.keys(CANONICAL_OPCODES).flatMap((name) => {
      const roles = fits(name, body)
      return roles ? [{ name, roles }] : []
    })
    if (
      names.length !== 1 ||
      among.some((other) => {
        const candidate = bodies.get(other)
        return candidate !== body && fits(names[0].name, candidate)
      })
    )
      return null
    for (const [key, value] of names[0].roles.dispatch) dispatch.set(key, value)
    return names[0].name
  }
  const opcodeFor = (label) => {
    if (!answers.has(label))
      answers.set(label, nameAmong(label, [...bodies.keys()]))
    return answers.get(label)
  }
  return {
    opcodeFor,
    nameAmong,
    sentinel: () => dispatch.get('_SPREAD') ?? null,
  }
}
