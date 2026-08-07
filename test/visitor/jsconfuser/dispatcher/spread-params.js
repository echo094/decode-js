var __p_wIZc_cache = Object["create"](null);
var __p_SSmf_payload;
function __p_E0dl_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "MCcBbe": function () {
      var [...a] = __p_SSmf_payload;
      return a[0] + a[1] + a[2];
    }
  };
  if (flagArg === "ifeJGH9Zow") {
    __p_SSmf_payload = [];
  }
  if (flagArg === "zoeRvreLSE") {
    function createFunction() {
      var fn = function (...args) {
        __p_SSmf_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_Yv0a_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_wIZc_cache[name] || (__p_wIZc_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "lONPyg3R3E") {
    return {
      "9ri5RtodqZ": output
    };
  } else {
    return output;
  }
}
function __p_Yv0a_d_fnLength() {}
input((__p_SSmf_payload = [2, 10, 8], __p_E0dl_dispatcher_0("MCcBbe")));