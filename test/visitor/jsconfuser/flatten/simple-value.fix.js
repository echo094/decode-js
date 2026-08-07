var outsideVar = "Correct Value";
function myFunction(x, y) {
  if (x > 0) {
    outsideVar = outsideVar + x;
  }
  return outsideVar + y;
}
TEST_OUTPUT = myFunction(1, 2);