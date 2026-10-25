import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAntiRuntime } from '../../../src/vm/jsconfuser-vm/analyze-anti-runtime.js'
import { diagnoseNormalizeAntiWordcode } from '../../../src/vm/jsconfuser-vm/normalize-anti-wordcode.js'
import { diagnoseNormalizeMacroWordcode } from '../../../src/vm/jsconfuser-vm/normalize-macro-wordcode.js'
import { diagnoseMacroRuntime } from '../../../src/vm/jsconfuser-vm/observe-macro-runtime.js'
import { diagnoseSpecializedRuntime } from '../../../src/vm/jsconfuser-vm/observe-specialized-runtime.js'
import {
  diagnoseAntiWordStream,
  diagnoseMacroWordStream,
  readWordcode,
} from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import {
  decodeStandalone,
  diagnoseStandalone,
} from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(name, file) {
  return fs.readFileSync(
    new URL(`fixtures/${name}/${file}`, import.meta.url),
    'utf8',
  )
}

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test.each([
  'anti-runtime-boot',
  'anti-runtime-duplicate-step',
  'anti-runtime-finally',
  'anti-runtime-catch-finally',
])(
  'normalizes and decodes %s without changing the source container',
  (name) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const extracted = diagnoseContainer(encoded).result
    const originalWords = extracted.roles.words.values.slice()
    const normalized = diagnoseNormalizeAntiWordcode(encoded, extracted)
    expect(normalized.ok).toBe(true)
    expect(normalized.result.originalWordCount).toBe(originalWords.length)
    expect(normalized.result.container.roles.words.values.length).toBeLessThan(
      originalWords.length,
    )
    expect(readWordcode(normalized.result.container)).not.toBeNull()
    expect(extracted.roles.words.values).toEqual(originalWords)

    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok).toBe(true)
    expect(
      assertNoVmResidue(parseSuccessfulOutput(decoded.result.output)).ok,
    ).toBe(true)
    expect(
      assertDerivedStateConsistency(
        parseSuccessfulOutput(decoded.result.output),
        decoded.result.output,
      ).ok,
    ).toBe(true)
    expect(observe(decoded.result.output)).toEqual(observe(source))
    expect(observe(encoded)).toEqual(observe(source))
  },
)

// Anti proves its own fake jumps; a route that expands macro steps first hands them over unchanged.
const fakeJumpRoutes = [
  [
    'anti',
    'anti-runtime-duplicate-step',
    (encoded, container) => diagnoseNormalizeAntiWordcode(encoded, container),
    (encoded, extracted, anti) =>
      diagnoseAntiWordStream(extracted, anti).result,
  ],
  [
    'macro',
    'anti-macro-exceptions',
    (encoded, container) => diagnoseNormalizeMacroWordcode(encoded, container),
    (encoded, extracted, anti) => {
      const specialized = diagnoseSpecializedRuntime(encoded, {
        allowAntiPrefix: true,
        allowMacroTail: true,
      })
      const macro = diagnoseMacroRuntime(encoded, {
        antiObservation: anti,
        specializedObservation: specialized.ok ? specialized.result : null,
      }).result
      return diagnoseMacroWordStream(
        extracted,
        macro,
        specialized.ok ? specialized.result : null,
        anti,
      ).result
    },
  ],
]

test.each(fakeJumpRoutes)(
  'declines a changed fake jump on the %s route at anti without a normalized container',
  (_, name, normalize, readStream) => {
    const encoded = fixture(name, 'encoded.js')
    const extracted = diagnoseContainer(encoded).result
    const runtime = diagnoseAntiRuntime(encoded, {
      allowSpecializedTail: true,
    }).result
    const stream = readStream(encoded, extracted, runtime)
    const [synthetic, definition, jump] = stream.instructions
      .filter(({ name }) => name === 'SYNTHETIC')
      .map((instruction) => {
        const definition = runtime.syntheticCases.find(
          ({ opcode }) => opcode === instruction.opcode.value,
        )
        const jump = definition.steps.find(({ name }) =>
          name.startsWith('JUMP_IF'),
        )
        return [instruction, definition, jump]
      })
      .find(([, , jump]) => jump)
    const jumpStored = definition.canonicalToStored[jump.operandStart + 1]
    const targetIndex = synthetic.pc + 1 + jumpStored
    expect(extracted.roles.words.values[targetIndex]).toBe(synthetic.nextPc)
    const tampered = structuredClone(extracted)
    const originalWords = extracted.roles.words.values.slice()
    // One word past the fall-through: inside the next instruction, never a boundary.
    tampered.roles.words.values[targetIndex] += 1
    const normalized = normalize(encoded, tampered)
    expect(normalized).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'register-isolation' },
    })
    expect(extracted.roles.words.values).toEqual(originalWords)

    const malformed = encoded.replace(
      /^var BYTECODE = \[[^\n]+\];$/m,
      `var BYTECODE = ${JSON.stringify(tampered.roles.words.values)};`,
    )
    expect(malformed).not.toBe(encoded)
    expect(diagnoseStandalone(malformed)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'wordcode-declined' },
    })
    expect(decodeStandalone(malformed)).toBeNull()
  },
)
