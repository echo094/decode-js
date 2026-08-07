var seen = []
function step(n) {
  seen.push(n)
  return n * 2
}
function run(limit) {
  var acc = 0
  for (var i = 1; i <= limit; i++) {
    acc += step(i)
  }
  return acc
}
TEST_OUTPUT = [run(4), seen.join(",")]
