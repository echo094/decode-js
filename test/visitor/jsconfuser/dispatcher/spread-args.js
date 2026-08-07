var __p_nbpc_cache = Object["create"](null);
var __p_cJSD_payload;
function __p_Dikw_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "VrxasT": function () {
      var [x, y, z] = __p_cJSD_payload;
      return x + y + z;
    }
  };
  if (flagArg === "eXXGSjN8Uz") {
    __p_cJSD_payload = [];
  }
  if (flagArg === "sut2jF3dMS") {
    function createFunction() {
      var fn = function (...args) {
        __p_cJSD_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_cN3I_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_nbpc_cache[name] || (__p_nbpc_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "OFJtJpw0Es") {
    return {
      "xE0q37Otll": output
    };
  } else {
    return output;
  }
}
function __p_cN3I_d_fnLength() {}
input((__p_cJSD_payload = [...[2, 10, 8]], new __p_Dikw_dispatcher_0("VrxasT", "nfpjpthNnC", "OFJtJpw0Es")["xE0q37Otll"]));