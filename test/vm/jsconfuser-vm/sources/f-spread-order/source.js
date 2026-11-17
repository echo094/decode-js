function sum(a, b, c) { return a + b + c; }
var values = [1, 2];
var merged = { a: 1, b: 2, ...{ a: 3 } };
window.TEST_OUTPUT = [sum(...values, 3), merged];
