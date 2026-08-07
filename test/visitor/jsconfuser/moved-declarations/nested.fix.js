function outer(a) {
  function mid(b) {
    function inner(x) {
      return x + 1;
    }
    return inner(b);
  }
  return mid(a);
}