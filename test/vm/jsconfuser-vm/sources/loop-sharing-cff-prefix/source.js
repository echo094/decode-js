function f(n) {
  let s = 1;
  let c = 0;
  while (s !== 5) {
    c = c + n * s;
    s = s + 1;
  }
  return c;
}
window.TEST_OUTPUT = f(3);
