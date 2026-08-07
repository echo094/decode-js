function __p_calc(operator, a, b) {
  switch (operator) {
    case "opAdd":
      return a + b;
  }
}
var x = __p_calc("opUnknown", 1, 2);
console.log(x);