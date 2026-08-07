function hash(a, b) {
  a = a + 1;
  b = b + 2;
  switch (a) {
    case 1:
      a = a * 2;
      b = b * 2;
      break;
  }
  return a + b;
}
TEST_OUTPUT = hash(1, 2);
console.log(TEST_OUTPUT);