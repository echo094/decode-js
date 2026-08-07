TEST_OUTPUT = 0;
__p_ast(TEST_OUTPUT = 1, TEST_OUTPUT++, TEST_OUTPUT++, TEST_OUTPUT++);
if (TEST_OUTPUT > 0) {
  TEST_OUTPUT *= 2;
}
function __p_ast() {
  __p_ast = function () {};
}