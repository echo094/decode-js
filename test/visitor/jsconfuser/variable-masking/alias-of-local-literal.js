function test(..._vm) {
  _vm["length"] = 0;
  _vm["x"] = 10;
  _vm["y"] = _vm["x"];
  return _vm["y"];
}
console.log(test());