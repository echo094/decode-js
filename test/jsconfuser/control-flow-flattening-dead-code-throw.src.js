function tally(items) {
  var total = 0

  for (var i = 0; i < items.length; i++) {
    if (items[i] > 0) {
      total = total + items[i]
    } else {
      total = total - items[i]
    }
  }

  return total
}

var a = tally([3, -4, 5, -6])
console.log(a)
TEST_OUTPUT = a
