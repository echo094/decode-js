import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import controlFlow from '#visitor/jsconfuser/control-flow.js'

const root = join(__dirname, 'control-flow-literals')

// stateValues[i] is the concrete runtime value `states[i]` holds at this hand-picked
// block - in real output this comes from the (not-yet-built) transition-graph resolver,
// not from anything inferable in these fixtures alone.
const stateValues = [700, 1, 20, 45, 50]

test('number-simple', () => {
  const visitor = controlFlow.makeLiteralResolverVisitor({
    statesName: 'states',
    stateValues,
  })
  getResult(visitor, true, join(root, 'number-simple'))
})

test('number-nested-index', () => {
  const visitor = controlFlow.makeLiteralResolverVisitor({
    statesName: 'states',
    stateValues,
  })
  getResult(visitor, true, join(root, 'number-nested-index'))
})

test('boolean-eq', () => {
  const visitor = controlFlow.makeLiteralResolverVisitor({
    statesName: 'states',
    stateValues: [0, 0, 30],
  })
  getResult(visitor, true, join(root, 'boolean-eq'))
})

test('boolean-neq', () => {
  const visitor = controlFlow.makeLiteralResolverVisitor({
    statesName: 'states',
    stateValues: [0, 0, 30],
  })
  getResult(visitor, true, join(root, 'boolean-neq'))
})

test('string-xor', () => {
  const visitor = controlFlow.makeLiteralResolverVisitor({
    statesName: 'states',
    stateValues,
    xorFnName: '__xor',
    stringsBlob: 'XX^PRY>YY',
  })
  getResult(visitor, true, join(root, 'string-xor'))
})

test('not-a-state-ref', () => {
  const visitor = controlFlow.makeLiteralResolverVisitor({
    statesName: 'states',
    stateValues,
  })
  getResult(visitor, false, join(root, 'not-a-state-ref'))
})

test('not-a-boolean-shape', () => {
  const visitor = controlFlow.makeLiteralResolverVisitor({
    statesName: 'states',
    stateValues: [0, 0, 30],
  })
  getResult(visitor, false, join(root, 'not-a-boolean-shape'))
})
