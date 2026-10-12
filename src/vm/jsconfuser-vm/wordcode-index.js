// Index the successful Packet B record without parsing or validating it again.
export function indexWordcode(wordcode) {
  return {
    words: wordcode.words,
    instructions: wordcode.instructions,
    byPc: new Map(
      wordcode.instructions.map((instruction) => [instruction.pc, instruction]),
    ),
    boundaries: wordcode.instructions.map(({ pc }) => pc),
    boundarySet: new Set(wordcode.instructions.map(({ pc }) => pc)),
  }
}
