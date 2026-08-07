function __p_4Ef7_flat_TEST_FUNCTION(__p_pPRp_flat_object, [x, y]) {
  function TEST_NESTED_FUNCTION(...__p_QZgC_args) {
    var __p_sfja_flat_object = {
      get "aG9mCwi"() {
        return x;
      },
      get "XlXRbe"() {
        return y;
      },
      "vQrAac"(...args) {
        return __p_pPRp_flat_object["Yy_Cg2"](...args);
      },
    };
    return __p_pPRp_flat_object["OmCAmm"](__p_sfja_flat_object, __p_QZgC_args);
  }
  return TEST_NESTED_FUNCTION();
}
function __p_PR0C_flat_TEST_NESTED_FUNCTION(__p_sfja_flat_object, []) {
  function TEST_INNER_FUNCTION(...__p_Y4u2_args) {
    var __p_IwDX_flat_object = {};
    return __p_sfja_flat_object["vQrAac"](__p_IwDX_flat_object, __p_Y4u2_args);
  }
  return TEST_INNER_FUNCTION(
    __p_sfja_flat_object["aG9mCwi"],
    __p_sfja_flat_object["XlXRbe"],
  );
}
function __p_pmQb_flat_TEST_INNER_FUNCTION(__p_IwDX_flat_object, [a, b]) {
  return a + b;
}
function TEST_FUNCTION(...__p_KJGU_args) {
  var __p_pPRp_flat_object = {
    "Yy_Cg2"(...args) {
      return __p_pmQb_flat_TEST_INNER_FUNCTION(...args);
    },
    "OmCAmm"(...args) {
      return __p_PR0C_flat_TEST_NESTED_FUNCTION(...args);
    },
  };
  return __p_4Ef7_flat_TEST_FUNCTION(__p_pPRp_flat_object, __p_KJGU_args);
}
input(TEST_FUNCTION(10, 5));
