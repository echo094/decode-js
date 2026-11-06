import { expect, test } from 'vitest'
import { extractContainer } from '../../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../../src/vm/jsconfuser-vm/partition-functions.js'

// A hand-written boot: the VM construction carries the words and the pool, and the start call
// receives it with the root descriptor. The words hold `window.TEST_OUTPUT = 1 + 2`.
const source = `var vm = new VM(
  [4, 1, 2, 2, 0, 0, 0, 3, 1, 0, 0, 4, 2, 0, 0, 5, 3, 0, 11, 6, 4, 5, 9, 2, 3, 6, 0, 2, 4, 0, 45, 2],
  ['window', 'TEST_OUTPUT', 1, 2, undefined],
);
run(vm, new Closure({ startPc: 0, paramCount: 0, regCount: 7 }));`

const deepFrozen = (value) =>
  value === null ||
  typeof value !== 'object' ||
  (Object.isFrozen(value) && Object.values(value).every(deepFrozen))

test('reads its inputs without changing them and returns a deeply frozen partition', () => {
  const container = structuredClone(extractContainer(source))
  const wordcode = structuredClone(readWordcode(container))
  const references = structuredClone(validateReferences(container, wordcode))
  const before = JSON.stringify([container, wordcode, references])
  const result = partitionFunctions(container, wordcode, references)
  expect(result.functions).toHaveLength(1)
  expect(JSON.stringify([container, wordcode, references])).toBe(before)
  expect(deepFrozen(result)).toBe(true)
})
