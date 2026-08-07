function target(a, b) {
  function helper(x, y) {
    var sum = x + y + a;
    return sum;
  }
  var r = helper(a, b);
  return r + b;
}
console.log(target(3, 4));
