"use strict";

var outsideVar = "Correct Value";
function myFunction(x, y) {
  outsideVar = outsideVar + x;
  return outsideVar + y;
}
TEST_OUTPUT = myFunction(1, 2);