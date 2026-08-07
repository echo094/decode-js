function test(..._vm) {
  _vm[-5] = _vm[0];
  return _vm[0] + 1;
}
console.log(test(3));