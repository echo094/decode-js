function main(a, b, c) {
  function helper(y) {
    var z = y
    z++
    return z * 2
  }
  var total = a + b + helper(c)
  return total
}

function second(p, q) {
  var mid = p * 2
  return mid + q
}

TEST_OUTPUT = [main(1, 2, 3), second(4, 5)]
