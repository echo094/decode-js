function outer(a, b) {
  var total = a + b

  function helper(x) {
    var doubled = x * 2
    return doubled
  }

  var result = helper(total)

  function accumulate(y) {
    var sum = 0
    for (var i = 0; i < y; i++) {
      sum = sum + i
    }
    return sum
  }

  var acc = accumulate(result)
  return acc
}

function makeCounter() {
  var count = 0

  function increment() {
    var step = 1
    count = count + step
    return count
  }

  return increment
}

var counter = makeCounter()
var r1 = counter()
var r2 = counter()
var r3 = outer(3, 4)
console.log(r1, r2, r3)
TEST_OUTPUT = [r1, r2, r3]
