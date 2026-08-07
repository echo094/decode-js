function _eEGsTn(arg) {
  var acc;
  var helper;
  function scale(n) {
    return n * arg;
  }
  helper = function () {
    return scale(2) + arg;
  };
  acc = helper();
  input(acc);
}
_eEGsTn(10);