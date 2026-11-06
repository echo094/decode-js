function early(value) {
  return value + 1;
  value = 9;
  value = function () {
    return 9;
  };
  for (var key in value) value = key;
  return value;
}
function thrown() {
  try {
    throw 1;
    thrown.after = true;
  } catch (error) {
    return error;
  }
}
window.TEST_OUTPUT = [early(1), thrown()];
