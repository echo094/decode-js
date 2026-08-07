function target(a, b) {
  var x = 1;
  var w = 2;
  var result = x + w + a + b;
  if (result > 10) {
    result = result - 1;
  } else {
    result = result + 1;
  }
  return result;
}
console.log(target(3, 4));
