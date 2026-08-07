function test(_flat, [_b, _c]) {
  return _b + _c + _flat["k"];
}
console.log(test({
  k: 10
}, [1, 2]));