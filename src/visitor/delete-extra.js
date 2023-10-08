/**
 * 0x10 -> 16, "\u0058" -> "X"
 * not ASCII-safe (disable jsescOption:minimal to keep ASCII-safe)
 */
module.exports = {
  StringLiteral: ({ node }) => {
    delete node.extra
  },
  NumericLiteral: ({ node }) => {
    delete node.extra
  },
}
