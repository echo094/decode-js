function TEST_FUNCTION(x, y) {
  function TEST_NESTED_FUNCTION() {
    function TEST_INNER_FUNCTION(a, b) {
      return a + b;
    }
    return TEST_INNER_FUNCTION(x, y);
  }
  return TEST_NESTED_FUNCTION();
}
input(TEST_FUNCTION(10, 5));