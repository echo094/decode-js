var log = []

function sumSkip(n) {
  var total = 0
  for (var i = 0; i < n; i++) {
    if (i % 2 === 0) continue
    if (i > 50) break
    total += i
  }
  log.push('sum')
  return total
}

function classify(n) {
  var label = 'small'
  if (n > 100) {
    label = 'big'
  } else if (n > 10) {
    label = 'medium'
  }
  log.push(label)
  return label
}

var r1 = sumSkip(100)
var r2 = classify(200)
var r3 = classify(5)
console.log(r1, r2, r3, log.join(','))
TEST_OUTPUT = [r1, r2, r3, log.join(',')]
