function outer(a, mid) {
  if (!mid) {
    mid = function (b, inner) {
      if (!inner) {
        inner = function (x) {
          return x + 1;
        };
      }
      return inner(b);
    };
  }
  return mid(a);
}
