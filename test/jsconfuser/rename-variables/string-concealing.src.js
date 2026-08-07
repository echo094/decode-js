function outer(a, b) {
  console.log('outer message here, quite a bit longer than the default chunk size')
  function inner(c, d) {
    console.log('inner message here too, also long enough to trigger concealing')
    return c + d
  }
  return inner(a, b)
}
var label = 'a standalone top level string that is long enough to get concealed'
console.log(label)
TEST_OUTPUT = [outer(1, 2), label]
