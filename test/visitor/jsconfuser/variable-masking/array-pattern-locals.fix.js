var _payload = [3, 4];
function test(..._vm) {
  var [_local, _local2] = _payload;
  return _local + _local2;
}
console.log(test());