var log = []

function record(x) {
  log.push(x)
}

record('a')
record('b')
record('c')

function withBlock(n) {
  var acc = 0
  if (n > 0) {
    record('block-enter')
    record('block-mid')
    acc = acc + 1
    record('block-exit')
  }
  return acc
}

function withSwitch(n) {
  switch (n) {
    case 1:
      record('case1-a')
      record('case1-b')
      break
    default:
      record('case-default')
  }
}

record('d')
record('e')
var r1 = withBlock(1)
withSwitch(1)
console.log(log.join(','), r1)
TEST_OUTPUT = [log.join(','), r1]
