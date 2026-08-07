function __p_TBMK_flat_myFunction(__p_Iptf_flat_object, []) {
  return __p_Iptf_flat_object["fvrWKmC"];
}
var outsideVar = "Correct Value";
var myFunction = function (...__p_88Mr_args) {
  var __p_Iptf_flat_object = {
    get "fvrWKmC"() {
      return outsideVar;
    },
  };
  return __p_TBMK_flat_myFunction(__p_Iptf_flat_object, __p_88Mr_args);
};
TEST_OUTPUT = myFunction();
