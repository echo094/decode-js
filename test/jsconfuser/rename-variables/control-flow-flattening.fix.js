var WfpFqfl, N1CKBYh, PbC7kC, gr6K60, aA9Hnsn, uwlqHL;
WfpFqfl = function (M70QEI1) {
  var fZMzWUk;
  fZMzWUk = "small";
  if (M70QEI1 > 100) {
    fZMzWUk = "big";
  } else {
    if (M70QEI1 > 10) {
      fZMzWUk = "medium";
    }
  }
  PbC7kC["push"](fZMzWUk);
  return fZMzWUk;
};
N1CKBYh = function (jQ4dyl9) {
  var CoPqQVE, KK6Z9Q;
  CoPqQVE = 0;
  for (KK6Z9Q = 0; KK6Z9Q < jQ4dyl9; KK6Z9Q++) {
    if (KK6Z9Q % 2 === 0) {
      continue;
    }
    if (KK6Z9Q > 50) {
      break;
    }
    CoPqQVE += KK6Z9Q;
  }
  PbC7kC["push"]("sum");
  return CoPqQVE;
};
PbC7kC = [];
gr6K60 = N1CKBYh(100);
aA9Hnsn = WfpFqfl(200);
uwlqHL = WfpFqfl(5);
console["log"](gr6K60, aA9Hnsn, uwlqHL, PbC7kC["join"](","));
TEST_OUTPUT = [gr6K60, aA9Hnsn, uwlqHL, PbC7kC["join"](",")];