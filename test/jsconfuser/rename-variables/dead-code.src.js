function add(x, y) {
  var sum = x + y
  return sum
}

function multiply(a, b) {
  var product = a * b
  return product
}

var total = add(2, 3)
var scaled = multiply(total, 4)
TEST_OUTPUT = [total, scaled, add(10, 20)]
