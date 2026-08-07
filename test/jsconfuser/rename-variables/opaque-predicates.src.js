function outer(a, b) {
  if (a > 0) {
    var inner1 = a + b
    return inner1
  } else {
    var inner2 = a - b
    return inner2
  }
}

function loopy(n) {
  var total = 0
  for (var i = 0; i < n; i++) {
    if (i % 2 === 0) {
      total += i
    } else {
      total -= i
    }
  }
  return total
}

function nested(x) {
  function helper(y) {
    if (y > 10) {
      return y * 2
    }
    return y
  }
  return helper(x) + helper(x + 1)
}

TEST_OUTPUT = [outer(3, 4), outer(-3, 4), loopy(10), nested(5), nested(20)]
