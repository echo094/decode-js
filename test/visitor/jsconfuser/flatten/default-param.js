function __p_Sx1P_flat_offset(__p_aJoz_flat_object, [x, y = __p_aJoz_flat_object["yFNeZY"]]) {
  return x + y;
}
var base = 100;
function offset(...__p_7lZz_args) {
  var __p_aJoz_flat_object = {
    get "yFNeZY"() {
      return base;
    },
  };
  return __p_Sx1P_flat_offset(__p_aJoz_flat_object, __p_7lZz_args);
}
TEST_OUTPUT = offset(5);
