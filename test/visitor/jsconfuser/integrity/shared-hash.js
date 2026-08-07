function hashFn(fnObject, seed, regex = new RegExp(" ", "g")) {
  var fnStringed = fnObject["toString"]()["replace"](regex, "");
  return hashLow(fnStringed, seed);
}
function realAdd(a, b) {
  return a + b;
}
function realSub(a, b) {
  return a - b;
}
function TEST_ADD() {
  var h = TEST_ADD.cache || (TEST_ADD.cache = hashFn(realAdd, 111));
  if (h === 111111) {
    return realAdd(...arguments);
  } else {}
}
function TEST_SUB() {
  var h = TEST_SUB.cache || (TEST_SUB.cache = hashFn(realSub, 222));
  if (h === 222222) {
    return realSub(...arguments);
  } else {}
}
TEST_OUTPUT = TEST_ADD(5, 2) + TEST_SUB(5, 2);
