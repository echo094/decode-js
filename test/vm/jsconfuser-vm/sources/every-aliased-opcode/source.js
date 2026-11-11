var a = 6, b = 3, o = { k: 1 }, list = [a, b];
o.k = a + b; o["m"] = a - b;
function call(x) { return x * 2; }
var out = [a / b, a % b, a & b, a | b, a ^ b, a << b, a >> b, a < b, a > b, a === b, a !== b, -a, !a, typeof a];
window.TEST_OUTPUT = [out, o.k, o.m, call(a), list.length, new Array(2).length];
