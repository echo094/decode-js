function outer(a, helper, total) {
  function helper(x) {
    return x * 2;
  }
  total = helper(a);
  return total;
}