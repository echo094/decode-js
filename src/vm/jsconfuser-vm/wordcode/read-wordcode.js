import { deepFreeze } from '../../decline.js'
import {
  makeCursor,
  parseInstruction,
  parseWords,
} from './wordcode-instructions.js'
import { decline, accepted, refused } from './wordcode-operands.js'

const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'

// The decode's own opcode table (opcode-table.js) gives each word its operation, and its
// sentinel marks a spread argument count.
function opcodeNames(container) {
  const names = new Map(
    Object.entries(container.roles.op.values).map(([name, value]) => [
      value,
      name,
    ]),
  )
  names.sentinel = container.roles.sentinels.values.CALL_SPREAD
  return names
}

function numericWords(container) {
  return container.roles.words.values
}

// PATCH traversal reads only reached words, using the same source-proved added-opcode
// definitions as the complete stream readers. Original widths remain intact.
export function diagnoseObservedWordcodeInstruction(
  container,
  pc,
  addedOpcodes = {},
) {
  try {
    const words = numericWords(container)
    const antiCases = opcodeMap(addedOpcodes.anti?.syntheticCases ?? [])
    const aliasCases = opcodeMap(addedOpcodes.alias?.aliases ?? [])
    const cases = new Map(antiCases)
    for (const entry of aliasCases.values()) {
      cases.set(entry.opcode, {
        ...entry,
        steps: [
          {
            name: entry.originalName,
            operandStart: 0,
            operandCount: entry.arity,
          },
        ],
      })
    }
    const instruction = parseInstruction(
      makeCursor(words, opcodeNames(container), pc),
      words,
      cases,
      opcodeMap(addedOpcodes.macro?.macros ?? []),
      opcodeMap(addedOpcodes.specialized?.specialized ?? []),
    )
    const alias = aliasCases.get(instruction.opcode.value)
    if (alias) {
      instruction.name = 'ALIAS'
      instruction.steps = [
        {
          name: alias.originalName,
          words: [alias.originalOpcode, ...instruction.canonicalOperands],
        },
      ]
    }
    return accepted(instruction, {
      fallback: 'word-reader-error',
      freeze: true,
    })
  } catch (error) {
    return refused(error, { fallback: 'word-reader-error', freeze: true })
  }
}

// Runtime observers establish these definitions from source before stream parsing.
function opcodeMap(entries) {
  return new Map(entries.map((entry) => [entry.opcode, entry]))
}

// An added-opcode word stream: the words parsed with the observed cases, published only when an
// instruction of the observed kind is present. `describe` builds the cases inside the run, so a
// malformed observation is the stream's own refusal.
function diagnoseWordStream(container, { kind, fallback }, describe) {
  try {
    const words = numericWords(container)
    const { cases, macroCases, specializedCases, observed, absent } = describe()
    const instructions = parseWords(
      words,
      opcodeNames(container),
      cases,
      macroCases,
      specializedCases,
    )
    if (!instructions.some(observed)) decline(...absent)
    return accepted(
      {
        schemaVersion: `jsconfuser-vm-${kind}-word-stream-observation.v1`,
        wordCount: words.length,
        instructions,
      },
      { fallback, freeze: true },
    )
  } catch (error) {
    return refused(error, { fallback, freeze: true })
  }
}

const casesOf = (observation, field) =>
  observation ? opcodeMap(observation[field]) : new Map()

export function diagnoseAntiWordStream(container, observation) {
  return diagnoseWordStream(
    container,
    { kind: 'anti', fallback: 'anti-word-stream-error' },
    () => ({
      cases: opcodeMap(observation.syntheticCases),
      observed: ({ name }) => name === 'SYNTHETIC',
      absent: [
        'no-synthetic-instructions',
        'The word stream has no synthetic opcode',
      ],
    }),
  )
}

export function diagnoseAliasedWordStream(
  container,
  observation,
  {
    antiObservation = null,
    specializedObservation = null,
    macroObservation = null,
  } = {},
) {
  return diagnoseWordStream(
    container,
    { kind: 'aliased', fallback: 'aliased-word-stream-error' },
    () => {
      const antiCases = casesOf(antiObservation, 'syntheticCases')
      const cases = new Map(antiCases)
      for (const entry of observation.aliases) {
        cases.set(entry.opcode, {
          ...entry,
          steps: [
            {
              name: entry.originalName,
              operandStart: 0,
              operandCount: entry.arity,
            },
          ],
        })
      }
      return {
        cases,
        macroCases: casesOf(macroObservation, 'macros'),
        specializedCases: casesOf(specializedObservation, 'specialized'),
        observed: ({ name, opcode }) =>
          name === 'SYNTHETIC' && !antiCases.has(opcode.value),
        absent: [
          'no-alias-instructions',
          'The word stream has no alias opcode',
        ],
      }
    },
  )
}

export function diagnoseMacroWordStream(
  container,
  observation,
  specializedObservation,
  antiObservation,
) {
  return diagnoseWordStream(
    container,
    { kind: 'macro', fallback: 'macro-word-stream-error' },
    () => ({
      cases: casesOf(antiObservation, 'syntheticCases'),
      macroCases: opcodeMap(observation.macros),
      specializedCases: casesOf(specializedObservation, 'specialized'),
      observed: ({ name }) => name === 'MACRO',
      absent: ['no-macro-instructions', 'The word stream has no macro opcode'],
    }),
  )
}

export function diagnoseSpecializedWordStream(
  container,
  observation,
  antiObservation,
) {
  return diagnoseWordStream(
    container,
    { kind: 'specialized', fallback: 'specialized-word-stream-error' },
    () => ({
      cases: casesOf(antiObservation, 'syntheticCases'),
      specializedCases: opcodeMap(observation.specialized),
      observed: ({ name }) => name === 'SPECIALIZED',
      absent: [
        'no-specialized-instructions',
        'The word stream has no specialized opcode',
      ],
    }),
  )
}

function recognize(container) {
  const words = numericWords(container)
  const instructions = parseWords(words, opcodeNames(container))
  return deepFreeze({
    schemaVersion: WORDCODE_SCHEMA,
    encoding: 'numeric-u32',
    words: words.slice(),
    wordCount: words.length,
    instructions,
    instructionCount: instructions.length,
    consumedWords: words.length,
    nextPc: words.length,
  })
}

export function diagnoseWordcode(container) {
  try {
    return accepted(recognize(container), {
      fallback: 'word-reader-error',
      freeze: true,
    })
  } catch (error) {
    return refused(error, {
      fallback: 'word-reader-error',
      freeze: true,
    })
  }
}

export function readWordcode(container) {
  return diagnoseWordcode(container).result
}
