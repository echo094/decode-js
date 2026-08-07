function target(a, b) {
  function inner(x, y) {
    return x + y + a;
  }
  var result = inner(a, b);
  return result + b;
}
console.log(target(3, 4));
