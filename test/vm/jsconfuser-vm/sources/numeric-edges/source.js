var negativeZero = -0;
var scaled = 0 * -1;
var high = Infinity;
var low = -Infinity;
var missing = NaN;
var count = 0;
for (var i = 3; i >= 0; i--) count++;
window.TEST_OUTPUT = [
  negativeZero,
  scaled,
  1 / negativeZero,
  high,
  low,
  missing,
  0 / 0,
  count,
  high >= 1e308,
  missing >= 0,
  negativeZero >= 0,
  low >= high,
]
