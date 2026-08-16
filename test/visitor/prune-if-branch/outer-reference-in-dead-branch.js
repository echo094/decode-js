function f() {
  var keep = 1;
  if ("abcde" !== "abcde") {
    helper(keep);
  }
  return keep;
}