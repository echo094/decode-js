function test(..._vm) {
  _vm["length"] = 1;
  _vm["a"] = external(_vm[0]);
  _vm["a"] = external(_vm["a"]);
  return _vm["a"];
}
console.log(test(3));
