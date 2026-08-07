var yh8gL7l;
function _x2Ahie(r9czNh) {
  var gsEFaL, Q0Keaz, PBYG4P0;
  gsEFaL = 0;
  Q0Keaz = 0;
  for (PBYG4P0 = 0; PBYG4P0 < r9czNh["length"]; PBYG4P0++) {
    if (r9czNh[PBYG4P0] % 2 === 0) {
      gsEFaL = gsEFaL + r9czNh[PBYG4P0];
    } else {
      Q0Keaz = Q0Keaz + r9czNh[PBYG4P0];
    }
  }
  if (gsEFaL > Q0Keaz) {
    return gsEFaL - Q0Keaz;
  } else {
    return Q0Keaz - gsEFaL;
  }
}
yh8gL7l = _x2Ahie([1, 2, 3, 4, 5, 6, 7]);
console["log"](yh8gL7l);
TEST_OUTPUT = yh8gL7l;