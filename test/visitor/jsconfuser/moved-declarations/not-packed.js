function localVarNotParam(x) {
  var f;
  if (!f) {
    f = function () {
      return 1;
    };
  }
  return f(x);
}
function namedFunctionExpression(x, f) {
  if (!f) {
    f = function named() {
      return 2;
    };
  }
  return f(x);
}
function paramWrittenTwice(x, f) {
  if (!f) {
    f = function () {
      return 3;
    };
  }
  f = null;
  return f;
}
function guardHasAlternate(x, f) {
  if (!f) {
    f = function () {
      return 4;
    };
  } else {
    f = null;
  }
  return f(x);
}