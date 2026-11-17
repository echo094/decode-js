// A program with no string constant: its pool is numbers and undefined, and the thrown value is
// what it leaves to compare.
function twice(value) {
  return value * 2
}
var flag = true
var missing = null
throw twice(flag && missing === null ? 3 : 4)
