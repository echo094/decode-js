var D_pAjsD, khgFr9p;
D_pAjsD = function (cM60q5) {
  var IPiKmB, QHEYhk;
  IPiKmB = 0;
  for (QHEYhk = 0; QHEYhk < cM60q5["length"]; QHEYhk++) {
    if (cM60q5[QHEYhk] > 0) {
      IPiKmB = IPiKmB + cM60q5[QHEYhk];
    } else {
      IPiKmB = IPiKmB - cM60q5[QHEYhk];
    }
  }
  return IPiKmB;
};
khgFr9p = D_pAjsD([3, -4, 5, -6]);
console["log"](khgFr9p);
TEST_OUTPUT = khgFr9p;