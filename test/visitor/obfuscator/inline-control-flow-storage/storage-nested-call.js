function run(fn) {
  var storage = {
    call: function (callee) {
      return callee();
    }
  };
  return storage.call(storage.call(fn));
}
