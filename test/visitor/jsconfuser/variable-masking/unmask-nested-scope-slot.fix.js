function test(_p) {
  var _local;
  if (_p) {
    _local = 1;
  } else {
    _local = 2;
  }
  _local++;
  return _local;
}
console.log(test(0), test(1));