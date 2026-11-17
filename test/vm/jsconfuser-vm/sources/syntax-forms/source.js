// Source forms the compiler lowers that no other cell source contains.
var out = [];
var n = 7;
n *= 3; n /= 7; n %= 2; n **= 3; out.push(n);
var b = 12;
b &= 10; b ^= 3; b <<= 2; b >>= 1; b >>>= 1; out.push(b);
var o = { count: 5 };
out.push(--n, ++o.count, --o.count, o.count);
function grade(value) {
  switch (value) {
    case 1:
      return "one";
    case 2:
      return "two";
  }
  return "none";
}
out.push(grade(2), grade(9));
var trace = [];
outer: switch (n) {
  case 0:
    for (var i = 0; i < 3; i++) {
      if (i === 1) break outer;
      trace.push(i);
    }
    trace.push("unreached");
}
var w = 0;
spin: while (w < 5) {
  w++;
  if (w % 2) continue spin;
  if (w > 3) break spin;
  trace.push("w" + w);
}
var d = 0;
again: do {
  d++;
  if (d < 3) continue again;
  break again;
} while (true);
trace.push(d);
var keys = { a: 1, b: 2, c: 3 };
each: for (var k in keys) {
  if (k === "b") continue each;
  if (k === "c") break each;
  trace.push(k);
}
;;
out.push(trace);
var holes = [1, , 3];
out.push(holes.length, holes[1] === undefined);
var name = "dyn";
var acc = {
  stored: 2,
  get [name + "Get"]() { return this.stored * 10; },
  set [name + "Set"](v) { this.stored = v; },
  [name + "Method"]() { return this.stored + 1; },
};
acc.dynSet = 4;
out.push(acc.dynGet, acc.dynMethod());
out.push(n != 0, !n, !"");
window.TEST_OUTPUT = out;
