function test(..._vm) {
  _vm["length"] = 1;
  if (_vm[0]) {
    _vm["c"] = 1;
  } else {
    _vm["c"] = 2;
  }
  _vm["c"]++;
  return _vm["c"];
}
console.log(test(0), test(1));