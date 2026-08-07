function test(..._vm) {
  _vm["b"] = _vm[0];
  return _vm["b"];
}
console.log(test(7));