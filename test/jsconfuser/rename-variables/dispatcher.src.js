var counter = 0
function addTwoNumbers(a, b) {
  counter = counter + 1
  return a + b + counter
}
function multiplyTwoNumbers(x, y) {
  return x * y + counter
}
TEST_OUTPUT = [
  addTwoNumbers(2, 3),
  multiplyTwoNumbers(4, 5),
  addTwoNumbers(1, 1),
  counter,
]
