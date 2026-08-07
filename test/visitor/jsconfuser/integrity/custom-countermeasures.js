function hashFn(fnObject, seed, regex = new RegExp(" ", "g")) {
  var fnStringed = fnObject["toString"]()["replace"](regex, "");
  return hashLow(fnStringed, seed);
}
var hasInvoked = false;
function invokeCountermeasures() {
  if (hasInvoked) return;
  hasInvoked = true;
  myCountermeasures();
}
function realAdd(a, b) {
  return a + b;
}
function myCountermeasures() {
  throw new Error("nope");
}
function TEST_FUNCTION() {
  var h = TEST_FUNCTION.cache || (TEST_FUNCTION.cache = hashFn(realAdd, 12345));
  if (h === 999999) {
    return realAdd(...arguments);
  } else {
    invokeCountermeasures();
  }
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
