function test(..._rest) {
  var _flat, _b, _c;
  [_flat, [_b, _c]] = _rest;
  return _b + _c + _flat["k"];
}
console.log(test({
  k: 10
}, [1, 2]));