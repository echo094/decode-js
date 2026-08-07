function _DKuyb(_local) {
  ll9E2Su["push"](_local);
  return _local * 2;
}
function _PdccYB(_local2) {
  var _local3, _local4;
  _local3 = 0;
  for (_local4 = 1; _local4 <= _local2; _local4++) {
    _local3 += _DKuyb(_local4);
  }
  return _local3;
}
var ll9E2Su = [];
TEST_OUTPUT = [_PdccYB(4), ll9E2Su["join"](",")];