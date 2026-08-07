function __p_calc(operator, a, b) {
  switch (operator) {
    case "opAdd":
      return a + b;
    case "opSub":
      return a - b;
    case "opMul":
      return a * b;
    case "opDiv":
      return a / b;
  }
}
var x = __p_calc("opAdd", 1, 2);
var y = __p_calc("opSub", 10, 4);
var z = __p_calc("opMul", 3, 5);
var w = __p_calc("opDiv", 8, 2);
console.log(x, y, z, w);