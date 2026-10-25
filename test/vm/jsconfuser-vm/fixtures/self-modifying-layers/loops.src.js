function fibonacci(n) {
  var a = 0, b = 1;
  for (var i = 0; i < n; i++) {
    var next = a + b;
    a = b;
    b = next;
  }
  return a;
}
var inputs = [0, 1, 5, 10];
var values = [], sum = 0;
for (var j = 0; j < inputs.length; j++) {
  var value = fibonacci(inputs[j]);
  values.push(value);
  sum += value;
}
window.TEST_OUTPUT = { values: values, sum: sum };
console.log(JSON.stringify(window.TEST_OUTPUT));
