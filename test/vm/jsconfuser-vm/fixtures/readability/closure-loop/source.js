function makeAdder(base) {
  return function (value) {
    return base + value
  }
}

var add = makeAdder(4)
var total = 0
for (var index = 0; index < 3; index++) {
  total = total + add(index)
}
window.TEST_OUTPUT = total
