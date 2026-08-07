function tally(limit) {
  var total = 0

  function step(value) {
    return value % 2 === 0 ? value * 2 : value + 1
  }

  for (var i = 0; i < limit; i++) {
    total = total + step(i)
  }
  return total
}

var a = tally(6)
console.log(a)
TEST_OUTPUT = a
