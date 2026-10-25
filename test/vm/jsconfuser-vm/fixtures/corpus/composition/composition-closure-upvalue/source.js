function makeAccumulator(seed) {
  var total = seed;
  return function (step) { total += step; return total; };
}
var advance = makeAccumulator(4);
var first = advance(2);
var second = advance(first);
window.TEST_OUTPUT = [first, second, advance(1)];
