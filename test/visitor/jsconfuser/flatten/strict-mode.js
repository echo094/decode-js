"use strict";
function __p_28b8_flat_myFunction() {
  "use strict";
  var [__p_KM2X_flat_object, [x, y]] = arguments;
  __p_KM2X_flat_object["V0GBsDm"] = __p_KM2X_flat_object["V0GBsDm"] + x;
  return __p_KM2X_flat_object["V0GBsDm"] + y;
}
var outsideVar = "Correct Value";
function myFunction(...__p_DzAs_args) {
  var __p_KM2X_flat_object = {
    get "V0GBsDm"() {
      return outsideVar;
    },
    set "V0GBsDm"(__p_L2WE_value) {
      outsideVar = __p_L2WE_value;
    },
  };
  return __p_28b8_flat_myFunction(__p_KM2X_flat_object, __p_DzAs_args);
}
TEST_OUTPUT = myFunction(1, 2);
