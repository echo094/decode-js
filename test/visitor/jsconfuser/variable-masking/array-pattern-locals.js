var _payload = [3, 4];
function test(..._vm) {
  [_vm[-95], _vm[36]] = _payload;
  return _vm[-95] + _vm[36];
}
console.log(test());
