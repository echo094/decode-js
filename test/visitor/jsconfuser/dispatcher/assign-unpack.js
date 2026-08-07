var __p_3nXQ_cache = Object["create"](null);
var __p_4QxA_payload;
function __p_aH73_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "eEGsTn": function () {
      var acc, arg;
      [arg] = __p_4QxA_payload;
      acc = arg;
      input(acc);
    }
  };
  if (flagArg === "8YnqkbMvXe") {
    __p_4QxA_payload = [];
  }
  if (flagArg === "HInSJm4Qmw") {
    function createFunction() {
      var fn = function (...args) {
        __p_4QxA_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_Daw3_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_3nXQ_cache[name] || (__p_3nXQ_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "flY9pUXLA0") {
    return {
      "8xR732J77Q": output
    };
  } else {
    return output;
  }
}
function __p_Daw3_d_fnLength() {}
__p_4QxA_payload = [10], __p_aH73_dispatcher_0("eEGsTn");