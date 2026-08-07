function test(..._vm) {
  _vm["length"] = 2;
  var i = 1;
  return _vm[i];
}
console.log(test(7, 8));