var counter = 0;
function bump() {
  counter++;
}
function run(times) {
  for (var i = 0; i < times; i++) {
    bump();
  }
  return counter;
}
TEST_OUTPUT = run(5);
