function outer() {
  return function middle() {
    return function inner() {
      return "deep" + "-value";
    };
  };
}
window.TEST_OUTPUT = [outer()()()];
