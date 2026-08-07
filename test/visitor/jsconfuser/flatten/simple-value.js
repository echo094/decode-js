function __p_275o_flat_myFunction(__p_D6VC_flat_object, [x, y]) {
  if (x > 0) {
    __p_D6VC_flat_object["Q8CWn3"] = __p_D6VC_flat_object["Q8CWn3"] + x;
  }
  return __p_D6VC_flat_object["Q8CWn3"] + y;
}
var outsideVar = "Correct Value";
function myFunction(...__p_UoWp_args) {
  var __p_D6VC_flat_object = {
    get "Q8CWn3"() {
      return outsideVar;
    },
    set "Q8CWn3"(__p_EPdc_value) {
      outsideVar = __p_EPdc_value;
    },
  };
  return __p_275o_flat_myFunction(__p_D6VC_flat_object, __p_UoWp_args);
}
TEST_OUTPUT = myFunction(1, 2);
