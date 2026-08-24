var OUTER = {
  "eq": function (a, b) {
    return a == b;
  }
};
var INNER = {
  "eq": function (x, y) {
    return OUTER["eq"](x, y);
  }
};
var answer = INNER["eq"](2, 3);
