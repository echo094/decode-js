var ciwEaDu, p_cxlXq;
ciwEaDu = undefined;
p_cxlXq = undefined;
ciwEaDu = function (x) {
  var inner = function (y) {
    return p_cxlXq(x, y) * 2;
  };
  return inner(x + 1);
};
p_cxlXq = function (a, b) {
  var sum = a + b;
  return sum;
};
console["log"](ciwEaDu(3));
console["log"](ciwEaDu(20));