var trace = [];
var w = 0;
spin: while (w < 5) {
  w++;
  if (w % 2) continue spin;
  if (w > 3) break spin;
  trace.push("w" + w);
}
window.TEST_OUTPUT = [trace, w];
