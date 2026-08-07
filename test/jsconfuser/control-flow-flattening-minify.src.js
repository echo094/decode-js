var outer, adder;
outer = function (x) {
  var inner = function (y) {
    return adder(x, y) * 2;
  };
  return inner(x + 1);
};
adder = function (a, b) {
  var sum = a + b;
  return sum;
};
console.log(outer(3));
console.log(outer(20));
