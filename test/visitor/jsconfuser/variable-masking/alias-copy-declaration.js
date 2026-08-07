function test(..._rest) {
  var _stk;
  [..._stk] = _rest;
  _stk["length"] = 1;
  _stk["b"] = _stk[0];
  return _stk["b"];
}
console.log(test(7));