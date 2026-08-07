function getStr(start, length) {
  return decodeFn(strArray["substring"](start, start + length));
}
TEST_OUTPUT = getStr(0, 5);