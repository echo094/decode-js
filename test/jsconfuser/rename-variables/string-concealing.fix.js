function ZEHkOdI(csrp7a, dsKpjJ) {
  console["log"]("outer message here, quite a bit longer than the default chunk size");
  function EoD4zM(csrp7a, fezuZIf) {
    console["log"]("inner message here too, also long enough to trigger concealing");
    return csrp7a + fezuZIf;
  }
  return EoD4zM(csrp7a, dsKpjJ);
}
var C_wXR12 = "a standalone top level string that is long enough to get concealed";
console["log"](C_wXR12);
TEST_OUTPUT = [ZEHkOdI(1, 2), C_wXR12];