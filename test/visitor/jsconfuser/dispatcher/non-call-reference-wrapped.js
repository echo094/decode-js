var __p_2G2D_cache = Object["create"](null);
var __p_5i6U_payload;
function __p_bEwa_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "Sanzq0": function () {
      var [x] = __p_5i6U_payload;
      return x;
    }
  };
  if (flagArg === "15bb3QI297") {
    __p_5i6U_payload = [];
  }
  if (flagArg === "wVvC6pNi9q") {
    function createFunction() {
      var fn = function (...args) {
        __p_5i6U_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_kT23_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_2G2D_cache[name] || (__p_2G2D_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "pHttCGxvYy") {
    return {
      "kF7wu6wfNG": output
    };
  } else {
    return output;
  }
}
function __p_kT23_d_fnLength() {}
var fn = __p_bEwa_dispatcher_0("Sanzq0", "wVvC6pNi9q", "pHttCGxvYy")["kF7wu6wfNG"];
input(fn(10));