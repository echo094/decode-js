function __p_calc(operator, a, b) {
  if (operator === "opAdd") {
    return a + b;
  }
  return a - b;
}
var x = __p_calc("opAdd", 1, 2);
console.log(x);