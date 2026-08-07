function FunctionA() {
  function FunctionB() {
    var bVar = 10;
    return bVar;
  }
  var bFn = FunctionB;
  var aVar = bFn();
  return aVar + 1;
}
TEST_OUTPUT = FunctionA();