var __p_DDYl_cache = Object["create"](null);
var __p_Rzbt_payload;
function __p_cASk_dispatcher_1(name, flagArg, returnTypeArg, fnLengths = {}) {
  var output;
  var fns = {
    "7fqrnl": function () {
      var __p_ZXaQ_cache = Object["create"](null);
      var __p_Ofmv_payload;
      function __p_Wtu4_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {}) {
        var output;
        var fns = {
          "ACljVc": function () {
            return 100;
          }
        };
        if (flagArg === "KJPF7ewgJu") {
          __p_Ofmv_payload = [];
        }
        if (flagArg === "4PuuOsNJ3H") {
          function createFunction() {
            var fn = function (...args) {
              __p_Ofmv_payload = args;
              return fns[name].apply(this);
            };
            var fnLength = fnLengths[name];
            if (fnLength) {
              __p_qYpo_d_fnLength(fn, fnLength);
            }
            return fn;
          }
          output = __p_ZXaQ_cache[name] || (__p_ZXaQ_cache[name] = createFunction());
        } else {
          output = fns[name]();
        }
        if (returnTypeArg === "2DZtfUan1t") {
          return {
            "pzADDkYSn1": output
          };
        } else {
          return output;
        }
      }
      return __p_Wtu4_dispatcher_0("ACljVc", "KJPF7ewgJu");
    }
  };
  if (flagArg === "kReeehdLw6") {
    __p_Rzbt_payload = [];
  }
  if (flagArg === "GymK9fCADt") {
    function createFunction() {
      var fn = function (...args) {
        __p_Rzbt_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_qYpo_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_DDYl_cache[name] || (__p_DDYl_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "eKa09IAA5a") {
    return {
      "uXqjNqUxh0": output
    };
  } else {
    return output;
  }
}
function __p_qYpo_d_fnLength() {}
input(__p_cASk_dispatcher_1("7fqrnl", "kReeehdLw6"));