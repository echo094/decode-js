function hash(a, b) {
  __p_ast2(a = a + 1, b = b + 2);
  switch (a) {
    case 1:
      __p_ast2(a = a * 2, b = b * 2);
      break;
  }
  return a + b;
}
__p_ast2(TEST_OUTPUT = hash(1, 2), console.log(TEST_OUTPUT));
function __p_ast2() {
  __p_ast2 = function () {};
}