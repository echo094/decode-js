var a = 7, b = 2, s = "ab";
window.TEST_OUTPUT = [
  a + b, a - b, a * b, a / b, a % b, a ** b,
  a & b, a | b, a ^ b, ~a, a << b, a >> b, -a >>> 28,
  a == b, a != b, a === 7, a !== 7, a < b, a <= b, a > b, a >= b,
  -a, +s, !a, typeof a, typeof missing, void a,
  "length" in { length: 1 }, [] instanceof Array, s + a,
];
