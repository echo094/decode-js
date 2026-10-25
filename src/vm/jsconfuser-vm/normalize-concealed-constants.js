import { diagnoseWordcode } from './read-wordcode.js'

class ConcealedDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function decline(code, message) {
  throw new ConcealedDecline(code, message)
}

function deconcealString(value, key) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    decline('concealed-string', 'Concealed string is not canonical base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value || bytes.length % 2 !== 0) {
    decline('concealed-string', 'Concealed string is not u16 LE base64')
  }
  let state = key
  let result = ''
  for (let index = 0; index < bytes.length; index += 2) {
    state = (state + 0x9e3779b9) | 0
    const word = (state ^ (state >>> 13)) & 0xffff
    result += String.fromCharCode(
      (bytes[index] | (bytes[index + 1] << 8)) ^ word,
    )
  }
  return result
}

export function restoreConcealedValue(value, key) {
  if (key === 0) return value
  if (typeof value === 'number' && Number.isInteger(value)) return value ^ key
  if (typeof value === 'string') return deconcealString(value, key)
  decline('concealed-value', 'Pool entry has no concealable value')
}

function recognize(container, wordcode) {
  const pairs = []
  const keys = new Map()
  for (const instruction of wordcode.instructions) {
    const offset = instruction.name === 'STORE_GLOBAL' ? 2 : 3
    for (const operand of instruction.operands) {
      if (operand.kind !== 'constant-ref') continue
      const { index, concealKey: key } = operand
      if (keys.has(index) && keys.get(index) !== key) {
        decline('concealed-key', `Pool index ${index} has inconsistent keys`)
      }
      keys.set(index, key)
      pairs.push({ index, key, keyPc: instruction.pc + offset })
    }
  }
  if (!pairs.some(({ key }) => key !== 0)) {
    decline('no-concealed-constants', 'No concealed constant operand exists')
  }
  const normalized = structuredClone(container)
  const pool = normalized.roles.pool.values
  for (const [index, key] of keys) {
    if (index >= pool.length) {
      decline('concealed-index', `Pool index ${index} is out of range`)
    }
    if (key === 0) continue
    pool[index] = restoreConcealedValue(pool[index], key)
  }
  for (const { key, keyPc } of pairs) {
    if (key !== 0) normalized.roles.words.values[keyPc] = 0
  }
  const canonical = diagnoseWordcode(normalized)
  if (!canonical.ok) {
    decline('concealed-wordcode', canonical.diagnostic.message)
  }
  return {
    schemaVersion: 'jsconfuser-vm-concealed-constants-normalization.v1',
    container: normalized,
    wordcode: canonical.result,
    concealedPoolEntries: [...keys.values()].filter((key) => key !== 0).length,
  }
}

export function diagnoseNormalizeConcealedConstants(
  source,
  container,
  wordcode,
) {
  try {
    return {
      ok: true,
      result: recognize(container, wordcode),
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof ConcealedDecline
            ? error.code
            : 'concealed-normalization-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
