var __p_dCT3_cache = Object["create"](null);
var __p_bkJN_payload;
function __p_mfwk_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "7huBOQ": function () {
      return 5;
    }
  };
  if (flagArg === "xbJN6JrzjR") {
    __p_bkJN_payload = [];
  }
  if (flagArg === "roUYe1EkK0") {
    function createFunction() {
      var fn = function (...args) {
        __p_bkJN_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_faIv_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_dCT3_cache[name] || (__p_dCT3_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "NSzQ6ZDJ7X") {
    return {
      "xyjkSEtFxm": output
    };
  } else {
    return output;
  }
}
function __p_faIv_d_fnLength() {}
input(__p_mfwk_dispatcher_0("7huBOQ", "xbJN6JrzjR"));