function test(..._vm) {
  _vm["length"] = 3;
  _vm["x"] = _vm[0] + _vm[1];
  _vm["y"] = _vm[1] + _vm[2];
  return _vm["x"] + _vm["y"];
}
console.log(test(1, 2, 3));
