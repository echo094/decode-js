var __p_OVBD_cache = Object["create"](null);
var __p_gNoT_payload;
function __p_JFc7_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "b2kZER": function () {
      var [a] = __p_gNoT_payload;
      return a + 1;
    },
    "enUcmr": function () {
      var [b] = __p_gNoT_payload;
      return b + 2;
    }
  };
  if (flagArg === "7z3e1b41jj") {
    __p_gNoT_payload = [];
  }
  if (flagArg === "gApiI8m9yp") {
    function createFunction() {
      var fn = function (...args) {
        __p_gNoT_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_MpPb_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_OVBD_cache[name] || (__p_OVBD_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "HsiADakGT5") {
    return {
      "NHe0tYfDyb": output
    };
  } else {
    return output;
  }
}
function __p_MpPb_d_fnLength() {}
input((__p_gNoT_payload = [1], __p_JFc7_dispatcher_0("b2kZER")) + (__p_gNoT_payload = [2], __p_JFc7_dispatcher_0("enUcmr", "z7oOTmkn0a", "HsiADakGT5")["NHe0tYfDyb"]));