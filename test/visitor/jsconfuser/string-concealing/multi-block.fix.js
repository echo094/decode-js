function OUTER_FUNCTION(a, b) {
  console["log"]("outer message here");
  function INNER_FUNCTION(c, d) {
    console["log"]("inner message here too");
    return c + d;
  }
  return INNER_FUNCTION(a, b);
}
TEST_OUTPUT = OUTER_FUNCTION(1, 2);