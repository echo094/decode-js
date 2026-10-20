function sum(...values) { return values.reduce(function (a, b) { return a + b; }, 0); }
function head(first, ...rest) { return [first, rest.length, rest[0], rest[1]]; }
window.TEST_OUTPUT = [sum(1, 2, 3, 4, 5), head(10, 20, 30), head(10)];
