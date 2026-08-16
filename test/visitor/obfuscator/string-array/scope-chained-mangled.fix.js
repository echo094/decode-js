const foo = "aaa";
function test(c, d) {
  const e = "bbb";
  const f = "ccc";
  function g(h, i) {
    const j = "ddd";
    const k = "eee";
    function l(m, n) {
      const o = "ddd";
      const p = "eee";
      return o + p;
    }
    return j + k;
  }
  return e + f + g();
}
foo + test();
process["stdout"]["write"](String(foo + test()) + '\x0a');