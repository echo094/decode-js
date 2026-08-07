var __p_uebu_cache = Object["create"](null);
var __p_Y1Dk_payload;
function __p_Cib4_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "Y4LFCe": function () {
      var [arg] = __p_Y1Dk_payload;
      input(arg);
    }
  };
  if (flagArg === "DeNVOZA2qx") {
    __p_Y1Dk_payload = [];
  }
  if (flagArg === "dRghrHk9VG") {
    function createFunction() {
      var fn = function (...args) {
        __p_Y1Dk_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_L74c_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_uebu_cache[name] || (__p_uebu_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "KsfIEJZtBq") {
    return {
      "g68ED4zBVS": output
    };
  } else {
    return output;
  }
}
function __p_L74c_d_fnLength() {}
__p_Y1Dk_payload = [10], new __p_Cib4_dispatcher_0("Y4LFCe", "k8Progzydi", "KsfIEJZtBq")["g68ED4zBVS"];