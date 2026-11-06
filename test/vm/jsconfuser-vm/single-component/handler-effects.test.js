import { parse } from '@babel/parser'
import { expect, test } from 'vitest'
import { PARSER_OPTIONS } from '../../../../src/vm/jsconfuser-vm/container-role-helpers.js'
import { templateEffects } from '../../../../src/vm/jsconfuser-vm/handler-effects.js'
import { normalizeStatements } from '../../../../src/vm/jsconfuser-vm/locate-handlers.js'

const effects = (source) =>
  templateEffects(
    normalizeStatements(parse(source, PARSER_OPTIONS).program.body),
  ).effects

// Minify writes a specialized BAND whose destination is its left operand as a compound assignment
// (corpus VM-GLM-1); the handler does what the written-out chain does.
test('a compound assignment has the effects of its written-out form', () => {
  expect(effects('$regs[$base + 85] &= $regs[$base + 84];')).toEqual(
    effects('$regs[$base + 85] = $regs[$base + 85] & $regs[$base + 84];'),
  )
  expect(effects('$regs[$base + $dst] += $regs[$base + $src];')).toEqual(
    effects('$regs[$base + $dst] = $regs[$base + $dst] + $regs[$base + $src];'),
  )
  // The target is read once, before the value: the left operand is the target, not the value.
  expect(effects('$regs[$base + 85] -= $regs[$base + 84];')).not.toEqual(
    effects('$regs[$base + 85] = $regs[$base + 84] - $regs[$base + 84];'),
  )
})

test('an XOR chain has one effect however it is grouped', () => {
  expect(effects('$x = $a ^ ($b ^ $c);')).toEqual(effects('$x = $a ^ $b ^ $c;'))
})
