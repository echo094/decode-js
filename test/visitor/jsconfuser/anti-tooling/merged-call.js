function F() {}
function target() {
  F(a(), b(), c());
  return d;
}
console.log(target());
