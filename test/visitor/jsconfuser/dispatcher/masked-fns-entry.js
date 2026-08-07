var __p_A0NK_cache = Object["create"](null);
var __p_wEM9_payload;
function __p_wAmL_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "DKUiK5": function (...__p_YIOp_varMask) {
      [__p_YIOp_varMask["b"], __p_YIOp_varMask[1], __p_YIOp_varMask["d"]] = __p_wEM9_payload;
      return __p_YIOp_varMask["b"] + __p_YIOp_varMask[1] + __p_YIOp_varMask["d"];
    }
  };
  if (flagArg === "W3k7kg2ZeY") {
    __p_wEM9_payload = [];
  }
  if (flagArg === "FxUo30VHvS") {
    function createFunction() {
      var fn = function (...args) {
        __p_wEM9_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_Gosw_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_A0NK_cache[name] || (__p_A0NK_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "HGl4l0GbV3") {
    return {
      "YjDNGe3xmN": output
    };
  } else {
    return output;
  }
}
function __p_Gosw_d_fnLength() {}
input((__p_wEM9_payload = [1, 2, 3], __p_wAmL_dispatcher_0("DKUiK5")));