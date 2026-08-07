function greet(name) {
  var greeting = 'Hello there, ' + name + '! Welcome to the string splitting test suite.'
  return greeting
}

var message = greet('World')
var label = 'This is a fairly long constant string literal for testing purposes'
console.log(message)
console.log(label)
console.log('Another standalone long string that should get split into chunks too')
TEST_OUTPUT = [message, label]
