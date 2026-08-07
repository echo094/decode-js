function outer() {
  var a = "shared-value";
  var b = "shared-value";
  function inner() {
    var c = "shared-value";
    var d = 12345;
    var e = 12345;
    return c + d + e;
  }
  return a + b + inner();
}

function outer2() {
  var f = "shared-value";
  var g = 12345;
  return f + g;
}

TEST_OUTPUT = [outer(), outer2()];
