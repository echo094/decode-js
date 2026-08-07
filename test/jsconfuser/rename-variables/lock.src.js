var lockPassed = true
function myCountermeasuresFn() {
  lockPassed = false
}
function myFunction(x, y) {
  return x + y
}
TEST_OUTPUT = [myFunction(1, 2), lockPassed]
