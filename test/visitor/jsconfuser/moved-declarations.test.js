import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deMovedDeclarationsInit from '#visitor/jsconfuser/moved-declarations'

const root = join(__dirname, 'moved-declarations')

test('simple', () => {
  const tc = 'simple'
  getResult(deMovedDeclarationsInit(), true, join(root, tc))
})

// The packed slot is not the last parameter (MovedDeclarations also packs plain variables
// into parameters, and those land after the function slots), so the declaration is restored
// but the dead slot stays - removing an interior parameter would renumber the rest.
test('trailing-var-slot', () => {
  const tc = 'trailing-var-slot'
  getResult(deMovedDeclarationsInit(), true, join(root, tc))
})

test('nested', () => {
  const tc = 'nested'
  getResult(deMovedDeclarationsInit(), true, join(root, tc))
})

// Four shapes that must not be mistaken for a packed declaration: a local `var` rather than
// a parameter, a *named* function expression (the encoder always clears the id), a slot
// written more than once, and a guard with an `else`.
test('not-packed', () => {
  const tc = 'not-packed'
  getResult(deMovedDeclarationsInit(), false, join(root, tc))
})
