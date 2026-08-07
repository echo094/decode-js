var __p_calc, x, y;
__p_calc = function (operator, a, b) {
  switch (operator) {
    case "opAdd":
      return a + b;
    case "opSub":
      return a - b;
  }
};
x = __p_calc("opAdd", 1, 2);
y = __p_calc("opSub", 10, 4);
console.log(x, y);
