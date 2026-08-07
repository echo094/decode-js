function test(..._vm) {
  _vm["length"] = 1;
  _vm["b"] = _vm[0];
  _vm[0] = _vm[0] + 1;
  return _vm["b"];
}
console.log(test(5));