var __p_calc, x;
__p_calc = function (operator, a, b) {
  switch (operator) {
    case "opAdd":
      return a + b;
  }
};
__p_calc = function () {};
x = __p_calc("opAdd", 1, 2);
console.log(x);