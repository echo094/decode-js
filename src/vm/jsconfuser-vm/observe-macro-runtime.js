import { parse } from '@babel/parser'
import {
  cloneRuntimeFragment,
  runtimeFragmentPattern,
} from './runtime-fragment-pattern.js'
import { diagnoseContainer } from './extract-container.js'
import {
  classCallLayouts,
  normalizeFakeCalls,
} from './observe-aliased-runtime.js'
import {
  ContainerDecline,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
  makeContext,
  numberValue,
  propertyName,
  prototypeMethods,
  topLevelDeclarations,
} from './container-role-helpers.js'

const ALWAYS_EXCLUDED = new Set([
  'PATCH',
  'TRY_SETUP',
  'TRY_END',
  'DEBUGGER',
  'MAKE_CLOSURE',
])
const NONTERMINAL_EXCLUDED = new Set([
  'RETURN',
  'CALL',
  'CALL_METHOD',
  'NEW',
  'THROW',
  'JUMP',
  'JUMP_IF_FALSE',
  'JUMP_IF_TRUE',
  'FOR_IN_NEXT',
  'FINALLY_SETUP',
])

function caseBody(entry) {
  const statements =
    entry.consequent.length === 1 &&
    entry.consequent[0].type === 'BlockStatement'
      ? entry.consequent[0].body
      : entry.consequent
  return statements.filter(
    (statement) =>
      statement.type !== 'BreakStatement' &&
      statement.type !== 'EmptyStatement',
  )
}

function pattern(statements, layouts, context) {
  const { nodes, origins } = cloneRuntimeFragment(statements)
  normalizeFakeCalls(nodes, layouts)
  return JSON.stringify(runtimeFragmentPattern(nodes, context, origins))
}

function decompose(entry, canonical, layouts, context) {
  const body = caseBody(entry)
  const candidates = canonical.map(({ name, opcode, entry: source }) => ({
    name,
    opcode,
    body: caseBody(source),
  }))
  const matches = []
  const visit = (position, sequence) => {
    if (position === body.length) {
      if (sequence.length >= 2 && sequence.length <= 5) matches.push(sequence)
      return
    }
    if (sequence.length >= 5) return
    for (const candidate of candidates) {
      if (
        candidate.body.length === 0 ||
        ALWAYS_EXCLUDED.has(candidate.name) ||
        (NONTERMINAL_EXCLUDED.has(candidate.name) &&
          position + candidate.body.length !== body.length) ||
        pattern(candidate.body, layouts, context) !==
          pattern(
            body.slice(position, position + candidate.body.length),
            layouts,
            context,
          )
      ) {
        continue
      }
      visit(position + candidate.body.length, [
        ...sequence,
        { name: candidate.name, opcode: candidate.opcode },
      ])
    }
  }
  visit(0, [])
  if (matches.length !== 1) {
    decline('macro-runtime', 'Macro case has no unique canonical decomposition')
  }
  return matches[0]
}

function recognize(
  ast,
  {
    antiObservation = null,
    specializedObservation = null,
    allowAliasTail = false,
  } = {},
) {
  const container = diagnoseContainer(ast)
  if (!container.ok) {
    decline('macro-runtime-container', 'Numeric container is not admitted')
  }
  const context = makeContext(ast)
  const roles = container.result.roles
  const declarations = topLevelDeclarations(context)
  const vm = declarations.filter(
    (item) =>
      item.kind === 'function' && item.name === roles.constructors.VM.name,
  )
  if (vm.length !== 1) decline('macro-runtime', 'VM constructor is not unique')
  const run = prototypeMethods(context, vm[0]).filter(
    (item) => item.name === roles.methods.vm.run.name,
  )
  if (run.length !== 1) decline('macro-runtime', 'VM run method is not unique')
  const switches = context
    .nodes(run[0].fn)
    .filter(({ node }) => node.type === 'SwitchStatement')
  if (switches.length !== 1)
    decline('macro-runtime', 'VM dispatch is not unique')
  const numericCanonical = roles.op.name === null
  const op = numericCanonical
    ? []
    : declarations.filter((item) => item.name === roles.op.name)
  if (!numericCanonical && op.length !== 1)
    decline('macro-runtime', 'Opcode map is not unique')
  const nameByOpcode = new Map(
    Object.entries(roles.op.values).map(([name, value]) => [value, name]),
  )
  const layouts = numericCanonical
    ? classCallLayouts(context, declarations, roles, {
        operand: roles.methods.vm.operand.name,
        constant: roles.methods.vm.constant.name,
      })
    : new Map()
  const canonical = []
  const extra = []
  for (const entry of switches[0].node.cases.filter((item) => item.test)) {
    const name = numericCanonical
      ? nameByOpcode.get(numberValue(entry.test))
      : entry.test.type === 'MemberExpression' &&
          !entry.test.computed &&
          context.sameRef(entry.test.object, op[0].binding)
        ? propertyName(entry.test.property)
        : null
    if (name) {
      if (!Object.hasOwn(roles.op.values, name)) {
        decline('macro-runtime', 'Dispatch uses an unknown canonical opcode')
      }
      canonical.push({ name, opcode: roles.op.values[name], entry })
    } else {
      extra.push(entry)
    }
  }
  if (
    canonical.length !== Object.keys(roles.op.values).length ||
    extra.length === 0
  ) {
    decline('macro-runtime', 'Canonical or macro cases are incomplete')
  }
  extra.sort((left, right) => numberValue(left.test) - numberValue(right.test))
  const antiPrefixCount = antiObservation?.syntheticCases.length ?? 0
  const specializedPrefixCount = specializedObservation?.specialized.length ?? 0
  const prefixCount = antiPrefixCount + specializedPrefixCount
  for (const [index, entry] of extra.slice(0, prefixCount).entries()) {
    if (numberValue(entry.test) !== 61 + index)
      decline('macro-runtime', 'Earlier opcode prefix is not contiguous')
  }
  if (extra.length <= prefixCount)
    decline('macro-runtime', 'No macro opcode cases remain')
  const macros = []
  for (const [index, entry] of extra.slice(prefixCount).entries()) {
    const opcode = numberValue(entry.test)
    if (
      opcode !== 61 + prefixCount + index ||
      entry.consequent.length !== 1 ||
      entry.consequent[0].type !== 'BlockStatement' ||
      entry.consequent[0].body.at(-1)?.type !== 'BreakStatement'
    ) {
      if (allowAliasTail) break
      decline('macro-runtime', 'Macro opcode range or case form changed')
    }
    let steps
    try {
      steps = decompose(entry, canonical, layouts, context)
    } catch (error) {
      if (!allowAliasTail || !(error instanceof ContainerDecline)) throw error
      break
    }
    macros.push({ opcode, steps })
  }
  if (macros.length === 0)
    decline('macro-runtime', 'No macro opcode cases remain')
  if (!allowAliasTail && macros.length !== extra.length - prefixCount)
    decline('macro-runtime', 'Unproved extra opcode cases remain')
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-macro-runtime-observation.v1',
    antiPrefixCount,
    specializedPrefixCount,
    macros,
  })
}

export function diagnoseMacroRuntime(input, options) {
  try {
    const ast = typeof input === 'string' ? parse(input, PARSER_OPTIONS) : input
    if (ast?.type !== 'File' && ast?.type !== 'Program') {
      decline('invalid-input', 'Expected source text or a Babel AST')
    }
    return deepFreeze({
      ok: true,
      result: recognize(ast, options),
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof ContainerDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'macro-runtime-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
