var __p_4YLT_cache = Object["create"](null);
var __p_Tx6x_payload;
function __p_23zN_dispatcher_0(name, flagArg, returnTypeArg, fnLengths = {
  "OOGbOx": 3
}) {
  var output;
  var fns = {
    "OOGbOx": function () {
      var [a, b, c] = __p_Tx6x_payload;
      return a + b + c;
    }
  };
  if (flagArg === "so0N7eCxri") {
    __p_Tx6x_payload = [];
  }
  if (flagArg === "AeAzsrAzF3") {
    function createFunction() {
      var fn = function (...args) {
        __p_Tx6x_payload = args;
        return fns[name].apply(this);
      };
      var fnLength = fnLengths[name];
      if (fnLength) {
        __p_Qf0Q_d_fnLength(fn, fnLength);
      }
      return fn;
    }
    output = __p_4YLT_cache[name] || (__p_4YLT_cache[name] = createFunction());
  } else {
    output = fns[name]();
  }
  if (returnTypeArg === "fXbMN0e8DF") {
    return {
      "wzwQmUfboR": output
    };
  } else {
    return output;
  }
}
function __p_Qf0Q_d_fnLength(fn, length = 1) {
  Object["defineProperty"](fn, "length", {
    "value": length,
    "configurable": false
  });
  return fn;
}
var fn = __p_23zN_dispatcher_0("OOGbOx", "AeAzsrAzF3");
TEST_OUTPUT_LEN = fn["length"];
TEST_OUTPUT_VAL = fn(1, 2, 3);