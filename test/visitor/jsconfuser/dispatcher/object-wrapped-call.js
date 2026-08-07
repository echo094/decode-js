var __p_kxMX_cache = Object["create"](null);
var __p_WFAt_payload;
function __p_bb83_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "QGaV4Z": function () {
      var [arg] = __p_WFAt_payload;
      input(arg);
    }
  };
  if (flagArg === "fXzq8a7QO6") {
    __p_WFAt_payload = [];
  }
  if (flagArg === "l0uqbY7OGJ") {
    function createFunction() {
      var fn = function (...args) {
        __p_WFAt_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_LMyG_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_kxMX_cache[name] || (__p_kxMX_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "29by2kycni") {
    return {
      "j4cafOUslj": output
    };
  } else {
    return output;
  }
}
function __p_LMyG_d_fnLength() {}
__p_WFAt_payload = [10], __p_bb83_dispatcher_0("QGaV4Z", "akpJnUg8RF", "29by2kycni")["j4cafOUslj"];