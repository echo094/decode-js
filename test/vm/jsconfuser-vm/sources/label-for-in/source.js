var trace = [];
var keys = { a: 1, b: 2, c: 3 };
each: for (var k in keys) {
  if (k === "b") continue each;
  if (k === "c") break each;
  trace.push(k);
}
window.TEST_OUTPUT = [trace];
