function classify(value) { return value % 2 === 0 ? value / 2 : value * 3 + 1; }
var trace = [];
var total = 0;
for (var i = 1; i <= 4; i++) {
  var transformed = classify(i);
  trace.push(transformed);
  if (transformed > 3) total += classify(transformed - 1);
  else total += transformed;
}
window.TEST_OUTPUT = { trace: trace, total: total };
