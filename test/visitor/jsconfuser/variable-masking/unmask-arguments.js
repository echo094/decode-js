function test(..._vm) {
  _vm["length"] = 1;
  return _vm[0] + arguments.length;
}
console.log(test(7));