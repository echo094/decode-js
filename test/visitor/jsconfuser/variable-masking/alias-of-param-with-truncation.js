function test(..._vm) {
  _vm["length"] = 1;
  _vm["b"] = _vm[0];
  return _vm["b"];
}
console.log(test(7));