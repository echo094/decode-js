import { declines } from '../../decline.js'

// The closed static evaluator of a dispatcher's decode closure (normalize-dispatcher-wordcode): one
// pass over its instructions in a private register frame, the listed operations only, never the
// target's own code. Its refusals are the dispatcher's.
const { decline } = declines('dispatcher')

const MATH = Symbol('pinned Math global')
const IMUL = Symbol('pinned Math.imul method')
const RECEIVER = Symbol('unused decode receiver')

function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    decline('dispatcher-decode', 'Decode closure used a nonnumeric value')
  }
  return value
}

// The decode closure's frame: its registers, args first, every access inside it.
function closureFrame(descriptor, args) {
  if (
    descriptor.captureCount !== 0 ||
    descriptor.hasRest ||
    descriptor.paramCount !== args.length ||
    descriptor.regCount < args.length
  ) {
    decline('dispatcher-closure', 'Decode closure has unexpected metadata')
  }
  const registers = Array(descriptor.regCount).fill(undefined)
  args.forEach((value, index) => {
    registers[index] = value
  })
  const inFrame = (index) =>
    Number.isInteger(index) && index >= 0 && index < registers.length
  return {
    read(index) {
      if (!inFrame(index)) {
        decline('dispatcher-closure', 'Decode closure reads outside its frame')
      }
      return registers[index]
    },
    write(index, value) {
      if (!inFrame(index)) {
        decline('dispatcher-closure', 'Decode closure writes outside its frame')
      }
      registers[index] = value
    },
  }
}

const ARITHMETIC = Object.freeze({
  ADD: (left, right) => left + right,
  SUB: (left, right) => left - right,
  BOR: (left, right) => left | right,
  BXOR: (left, right) => left ^ right,
  SHL: (left, right) => left << right,
  USHR: (left, right) => left >>> right,
})

// One step per opcode the decode closure may use: (words, frame, pool).
const CLOSURE_STEPS = Object.freeze({
  LOAD_THIS: (w, frame) => frame.write(w[1], RECEIVER),
  LOAD_INT: (w, frame) => frame.write(w[1], w[2]),
  LOAD_CONST: (w, frame, pool) => {
    if (w[3] !== 0 || w[2] >= pool.length) {
      decline('dispatcher-closure', 'Decode closure has an invalid constant')
    }
    frame.write(w[1], pool[w[2]])
  },
  LOAD_GLOBAL: (w, frame, pool) => {
    if (w[3] !== 0 || pool[w[2]] !== 'Math') {
      decline('dispatcher-closure', 'Decode closure reads another global')
    }
    frame.write(w[1], MATH)
  },
  GET_PROP: (w, frame) => {
    if (frame.read(w[2]) !== MATH || frame.read(w[3]) !== 'imul') {
      decline('dispatcher-closure', 'Decode closure reads another property')
    }
    frame.write(w[1], IMUL)
  },
  CALL_METHOD: (w, frame) => {
    if (
      frame.read(w[2]) !== MATH ||
      frame.read(w[3]) !== IMUL ||
      w[4] !== 2 ||
      w.length !== 7
    ) {
      decline('dispatcher-closure', 'Decode closure calls another method')
    }
    frame.write(
      w[1],
      Math.imul(number(frame.read(w[5])), number(frame.read(w[6]))),
    )
  },
  MOVE: (w, frame) => frame.write(w[1], frame.read(w[2])),
  UNARY_BITNOT: (w, frame) => frame.write(w[1], ~number(frame.read(w[2]))),
  ...Object.fromEntries(
    Object.entries(ARITHMETIC).map(([name, apply]) => [
      name,
      (w, frame) => {
        const left = number(frame.read(w[2]))
        const right = number(frame.read(w[3]))
        frame.write(w[1], apply(left, right))
      },
    ]),
  ),
  BUILD_ARRAY: (w, frame) => {
    if (w[2] !== 1 || w.length !== 4) {
      decline('dispatcher-closure', 'Decode array has unexpected width')
    }
    frame.write(w[1], { kind: 'array', value: frame.read(w[3]) })
  },
  BUILD_OBJECT: (w, frame) => {
    if (w[2] !== 1 || w.length !== 5 || typeof frame.read(w[3]) !== 'string') {
      decline('dispatcher-closure', 'Decode object has unexpected width')
    }
    frame.write(w[1], {
      kind: 'object',
      key: frame.read(w[3]),
      value: frame.read(w[4]),
    })
  },
})

// After its RETURN the closure keeps the compiler's dead `return undefined`.
function checkDeadReturn(tail, pool) {
  if (
    tail.length !== 2 ||
    tail[0].name !== 'LOAD_CONST' ||
    tail[0].words[3] !== 0 ||
    pool[tail[0].words[2]] !== undefined ||
    tail[1].name !== 'RETURN' ||
    tail[1].words[1] !== tail[0].words[1]
  ) {
    decline('dispatcher-closure', 'Decode closure has an unexpected tail')
  }
}

export function evaluateClosure(instructions, descriptor, pool, args) {
  const frame = closureFrame(descriptor, args)
  for (let index = 0; index < instructions.length; index += 1) {
    const { name, words } = instructions[index]
    if (name === 'RETURN') {
      const result = frame.read(words[1])
      checkDeadReturn(instructions.slice(index + 1), pool)
      return result
    }
    if (!Object.hasOwn(CLOSURE_STEPS, name)) {
      decline('dispatcher-closure', `Decode closure uses unsupported ${name}`)
    }
    CLOSURE_STEPS[name](words, frame, pool)
  }
  decline('dispatcher-closure', 'Decode closure has no return')
}
