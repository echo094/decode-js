function test(..._vm) {
  _vm["b"] = _vm[0];
  return _vm[0];
}
console.log(test(7));