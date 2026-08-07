function classify(values) {
  var evens = 0
  var odds = 0

  for (var i = 0; i < values.length; i++) {
    if (values[i] % 2 === 0) {
      evens = evens + values[i]
    } else {
      odds = odds + values[i]
    }
  }

  if (evens > odds) {
    return evens - odds
  }
  return odds - evens
}

var a = classify([1, 2, 3, 4, 5, 6, 7])
console.log(a)
TEST_OUTPUT = a
