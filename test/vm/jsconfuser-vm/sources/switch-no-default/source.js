function grade(value) {
  switch (value) {
    case 1:
      return "one";
    case 2:
      return "two";
  }
  return "none";
}
window.TEST_OUTPUT = [grade(1), grade(2), grade(9)];
