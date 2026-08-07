function outer(a, helper, total) {
  if (!helper) {
    helper = function (x) {
      return x * 2;
    };
  }
  total = helper(a);
  return total;
}
