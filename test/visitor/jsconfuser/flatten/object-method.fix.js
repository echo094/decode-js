var outsideVar = "Correct Value";
var myObject = {
  ["myMethod"]() {
    return outsideVar;
  }
};
TEST_OUTPUT = myObject["myMethod"]();