function TEST_FUNCTION() {
  var h = otherObject.cache || (otherObject.cache = hashFn(realAdd, 12345));
  if (h === 999999) {
    return realAdd(...arguments);
  } else {}
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);