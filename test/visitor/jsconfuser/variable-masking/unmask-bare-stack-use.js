function test(..._vm) {
  _vm["length"] = 1;
  external(_vm);
  return _vm[0];
}
console.log(test(7));