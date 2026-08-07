var __p_l7dI_cache = Object["create"](null);
var __p_hMc8_payload;
function __p_MYqj_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "4UVbdz": function () {
      var [x] = __p_hMc8_payload;
      return x;
    }
  };
  if (flagArg === "sYsQ0CzTkp") {
    __p_hMc8_payload = [];
  }
  if (flagArg === "7t4S7UzkM5") {
    function createFunction() {
      var fn = function (...args) {
        __p_hMc8_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_BQ1I_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_l7dI_cache[name] || (__p_l7dI_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "MWW5LLZAm6") {
    return {
      "jucexoYSXT": output
    };
  } else {
    return output;
  }
}
function __p_BQ1I_d_fnLength() {}
var fn = __p_MYqj_dispatcher_0("4UVbdz", "7t4S7UzkM5");
input(fn(10));