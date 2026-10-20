import { decline } from './container-role-helpers.js'

// The encoded transport's payload: canonical base64 of the words as u32 little-endian.
export function decodeCanonicalBytecodeWords(value) {
  if (
    typeof value !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    decline('encoded-bytecode', 'Payload is not canonical base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (
    bytes.length === 0 ||
    bytes.length % 4 !== 0 ||
    bytes.toString('base64') !== value
  ) {
    decline('encoded-bytecode', 'Payload is not a u32 LE byte stream')
  }
  return Array.from({ length: bytes.length / 4 }, (_, index) =>
    bytes.readUInt32LE(index * 4),
  )
}
