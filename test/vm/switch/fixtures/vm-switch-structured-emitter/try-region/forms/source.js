var log = [];
function f(fail) { log.push("f"); if (fail) throw new Error("f"); return 1; }
function g(value) { log.push("g:" + value); }
function emptyCatch(fail) { try { f(fail); } catch (e) {} g(1); }
function blockCatch(fail) { var x = 0; try { f(fail); } catch (e) { x = 1; x = x + 1; g(e.message); } g(x); }
function bindinglessCatch(fail) { try { f(fail); } catch { g(3); } g(4); }
function catchReturn(fail) { try { f(fail); } catch (e) { return 5; } return 6; }
function catchRethrow(fail) { try { f(fail); } catch (e) { g("re"); throw e; } return 7; }
function ifInCatch(fail) { var x = 0; try { f(fail); } catch (e) { if (e.message === "f") { x = 1; } else { x = 2; } } g(x); }
function nestedInCatch(fail) { try { f(fail); } catch (e) { try { f(fail); } catch (e2) { g("inner"); } } g(9); }
function nestedInBody(fail) { try { try { f(fail); } catch (e) { g("inner"); } f(fail); } catch (e) { g("outer"); } g(11); }
function finallyFall(fail) { try { f(fail); } finally { g("fin"); } g(2); }
function finallyReturnCall(fail) { try { return f(fail); } finally { g("fin"); } }
function catchFinallyFall(fail) { var x = 0; try { f(fail); } catch (e) { x = 1; } finally { x = x + 10; } g(x); }
var flag = 1;
function deadCatchCaptured(fail) { try { flag; } catch (e) { flag = 41; } g(flag); }
function deadCatchLocal(fail) { var y = 2; try { y; } catch (e) { y = 42; } g(y); }
function deadThrowPad(fail) { var z = 3; try { z; } finally { g("fin"); } g(z); }
function callFreeTry(fail) { var missing = null; try { if (fail) { definitely_missing_global; } } catch (error) { missing = [error.name, error instanceof ReferenceError]; } return missing; }
function loopFinally(fail) { var n = 0; for (var i = 0; i < 4; i++) { try { if (i === 1) continue; if (i === 3) break; f(fail && i === 2); n += i; } finally { n += 10; } } return n; }
function loopCatchBreak(fail) { var n = 0; for (var i = 0; i < 4; i++) { try { if (i === 3) break; f(fail && i === 1); n += i; } catch (e) { n += 100; } } return n; }
function loopCatchEndsInBreak(fail) { var n = 0; for (var i = 0; i < 4; i++) { try { f(fail && i === 2); n += i; } catch (e) { n += 100; break; } } return n; }
function doTryLoop(fail) { var n = 0, i = 0; do { try { f(fail && i === 1); n += i; } catch (e) { n += 100; } i++; } while (i < 3); return n; }
var forms = [emptyCatch, blockCatch, bindinglessCatch, catchReturn, catchRethrow, ifInCatch, nestedInCatch, nestedInBody, finallyFall, finallyReturnCall, catchFinallyFall, callFreeTry, deadCatchCaptured, deadCatchLocal, deadThrowPad, loopFinally, loopCatchBreak, loopCatchEndsInBreak, doTryLoop];
window.TEST_OUTPUT = [];
for (var step = 0; step < forms.length * 2; step++) {
  var index = step >> 1, fail = (step & 1) === 1;
  log = [];
  var outcome;
  try { outcome = ["value", forms[index](fail)]; } catch (error) { outcome = ["thrown", error.message]; }
  window.TEST_OUTPUT.push([index, fail, outcome, log]);
}
