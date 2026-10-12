export function indexReferences(references) {
  return {
    frame: references.frame,
    descriptors: references.frame.descriptors,
    labelByLocation: new Map(
      references.labels.references.map((reference) => [
        `${reference.pc}:${reference.operand}`,
        reference,
      ]),
    ),
  }
}

export function indexFunctions(functionsResult) {
  const functions = functionsResult.functions
  return {
    functions,
    functionById: new Map(functions.map((fn) => [fn.id, fn])),
    ownerByPc: new Map(
      functionsResult.ownership.map(({ pc, functionId }) => [pc, functionId]),
    ),
  }
}

export function registerIndices(instruction) {
  const raw = instruction.words
  const name = instruction.name
  if (
    name === 'LOAD_CONST' ||
    name === 'LOAD_INT' ||
    name === 'LOAD_GLOBAL' ||
    name === 'LOAD_UPVALUE' ||
    name === 'LOAD_THIS' ||
    name === 'MAKE_CLOSURE' ||
    name === 'BUILD_ARRAY' ||
    name === 'BUILD_OBJECT' ||
    name === 'FOR_IN_SETUP'
  ) {
    if (name === 'BUILD_ARRAY' || name === 'BUILD_OBJECT')
      return [raw[1], ...raw.slice(3)]
    if (name === 'FOR_IN_SETUP') return [raw[1], raw[2]]
    return [raw[1]]
  }
  if (name === 'STORE_GLOBAL') return [raw[3]]
  if (name === 'STORE_UPVALUE') return [raw[2]]
  if (name === 'MOVE') return [raw[1], raw[2]]
  if (
    name === 'GET_PROP' ||
    name === 'SET_PROP' ||
    name === 'DELETE_PROP' ||
    name === 'ADD' ||
    name === 'SUB' ||
    name === 'MUL' ||
    name === 'DIV' ||
    name === 'MOD' ||
    name === 'EXP' ||
    name === 'BAND' ||
    name === 'BOR' ||
    name === 'BXOR' ||
    name === 'SHL' ||
    name === 'SHR' ||
    name === 'USHR' ||
    name === 'LT' ||
    name === 'GT' ||
    name === 'LTE' ||
    name === 'GTE' ||
    name === 'EQ' ||
    name === 'NEQ' ||
    name === 'LOOSE_EQ' ||
    name === 'LOOSE_NEQ' ||
    name === 'IN' ||
    name === 'INSTANCEOF' ||
    name === 'DEFINE_GETTER' ||
    name === 'DEFINE_SETTER'
  ) {
    return raw.slice(1)
  }
  if (
    name === 'UNARY_NEG' ||
    name === 'UNARY_POS' ||
    name === 'UNARY_NOT' ||
    name === 'UNARY_BITNOT' ||
    name === 'TYPEOF' ||
    name === 'VOID' ||
    name === 'TYPEOF_SAFE'
  ) {
    return [raw[1]]
  }
  if (name === 'JUMP_IF_FALSE' || name === 'JUMP_IF_TRUE') return [raw[1]]
  if (name === 'CALL' || name === 'NEW') {
    return raw[3] === 65535
      ? [raw[1], raw[2], raw[4]]
      : [raw[1], raw[2], ...raw.slice(4)]
  }
  if (name === 'CALL_METHOD') {
    return raw[4] === 65535
      ? [raw[1], raw[2], raw[3], raw[5]]
      : [raw[1], raw[2], raw[3], ...raw.slice(5)]
  }
  if (name === 'RETURN' || name === 'THROW' || name === 'JUMP_REG')
    return [raw[1]]
  if (name === 'FOR_IN_NEXT') return [raw[1], raw[2]]
  if (name === 'FINALLY_SETUP') return [raw[2], raw[3]]
  return []
}
