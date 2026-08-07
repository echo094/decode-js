function outer(a, inner) {
  if (!inner) {
    inner = function (x) {
      return x * 2;
    };
  }
  return inner(a);
}
