function compute(a, b) {
  return Math.max(a, Math.min(a, b))
}

function stringify(x) {
  return JSON.stringify(x)
}

TEST_OUTPUT = [compute(3, 7), stringify({ a: 1 })]
