function hhHUnf(hhHUnf, a3mzrV) {
  if (hhHUnf > 0) {
    var Isyi4J = hhHUnf + a3mzrV;
    return Isyi4J;
  } else {
    var dJTy52B = hhHUnf - a3mzrV;
    return dJTy52B;
  }
}
function a3mzrV(hhHUnf) {
  var a3mzrV = 0;
  for (var Isyi4J = 0; Isyi4J < hhHUnf; Isyi4J++) {
    if (Isyi4J % 2 === 0) {
      a3mzrV += Isyi4J;
    } else {
      a3mzrV -= Isyi4J;
    }
  }
  return a3mzrV;
}
function Isyi4J(hhHUnf) {
  function a3mzrV(hhHUnf) {
    if (hhHUnf > 10) {
      return hhHUnf * 2;
    }
    return hhHUnf;
  }
  return a3mzrV(hhHUnf) + a3mzrV(hhHUnf + 1);
}
TEST_OUTPUT = [hhHUnf(3, 4), hhHUnf(-3, 4), a3mzrV(10), Isyi4J(5), Isyi4J(20)];