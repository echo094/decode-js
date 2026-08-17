function run() {
  var storage = {
    call: function (object, argument) {
      return object?.method(argument);
    }
  };
  return storage.call(null, 1);
}
