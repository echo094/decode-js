function __p_aRIu_flat_myMethod(__p_yjJt_flat_object, []) {
  return __p_yjJt_flat_object["dZegDdp"];
}
var outsideVar = "Correct Value";
var myObject = {
  ["myMethod"](...__p_peel_args) {
    var __p_yjJt_flat_object = {
      get "dZegDdp"() {
        return outsideVar;
      },
    };
    return __p_aRIu_flat_myMethod(__p_yjJt_flat_object, __p_peel_args);
  },
};
TEST_OUTPUT = myObject["myMethod"]();
