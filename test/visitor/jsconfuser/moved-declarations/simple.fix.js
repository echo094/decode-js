function outer(a) {
  function inner(x) {
    return x * 2;
  }
  return inner(a);
}