import { expect, test } from 'vitest'
import { selectContinuationLoads } from '../../../../src/vm/jsconfuser-vm/finally-continuations.js'

// Hand-written items for one function: FINALLY_SETUP names continuation register 5, a label load
// writes it, and a selfModifying filler LOAD_INT (an undecided PATCH suspect) happens to draw 5 too.
// The encoder emits that filler: dispatcher+macroOpcodes+selfModifying, seed 6, on a loop with
// continue and break through a finally.
const items = [
  {
    pc: 0,
    key: 'setup',
    functionId: 0,
    name: 'FINALLY_SETUP',
    words: [40, 30, 5, 0, 31],
  },
  { pc: 5, key: 'label', functionId: 0, name: 'LOAD_INT', words: [7, 5, 24] },
  { pc: 8, key: 'filler', functionId: 0, name: 'LOAD_INT', words: [7, 5, 913] },
  { pc: 11, key: 'other', functionId: 0, name: 'LOAD_INT', words: [7, 6, 12] },
]

test('a continuation load writes a FINALLY_SETUP continuation register of its function', () => {
  expect(selectContinuationLoads(items)).toEqual(new Set(['label', 'filler']))
})

test('a PATCH suspect is read past: its load keeps its words and its setup names nothing', () => {
  expect(selectContinuationLoads(items, new Set([8]))).toEqual(
    new Set(['label']),
  )
  expect(selectContinuationLoads(items, new Set([0]))).toEqual(new Set())
})
