function target(a, b) {
  var x = 1,
    y = 2,
    z = x + y + a + b;
  if (z > 10) {
    z = z - 1;
  } else {
    z = z + 1;
  }
  return z;
}
console.log(target(3, 4));
