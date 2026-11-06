var log = [];
function note(value) { log.push(value); }
function catchBreaksTry(fail) { a: try { throw 1; } catch (e) { note(e); break a; } finally { note("f"); } note("end"); }
function blockBreaksTry(fail) { a: try { note("b"); break a; } finally { note("f"); } note("end"); }
function catchBreaksLoop(fail) { for (var i = 0; i < 2; i++) { try { throw i; } catch (e) { note(e); break; } finally { note("f"); } } note("end"); }
function catchBreaksBlock(fail) { a: { try { throw 1; } catch (e) { break a; } finally { note("f"); } } note("end"); }
function breakPastDeadCode(fail) { a: { try { throw 1; } catch (e) { break a; } finally { note("f"); } note("dead"); } note("end"); }
function breakInsideLoop(fail) { for (var i = 0; i < 2; i++) { a: try { throw i; } catch (e) { note(e); break a; } finally { note("f"); } note("x"); } note("end"); }
function throughTwoFinally(fail) { a: try { try { throw 1; } catch (e) { break a; } finally { note("f1"); } } finally { note("f2"); } note("end"); }
function breakOrReturn(fail) { a: try { throw 1; } catch (e) { if (fail) break a; return 2; } finally { note("f"); } note("end"); return 3; }
function nestedInTry(fail) { try { a: try { throw 1; } catch (e) { break a; } finally { note("f"); } note("x"); } catch (e) { note(e); } note("end"); }
function catchRejoinsThenTail(fail) { try { try { throw 1; } catch (e) { log.push(e); } log.push("x"); } finally { log.push("f"); } log.push("end"); }
function breakBesideNormalEnd(fail) { a: try { if (fail) break a; note("x"); } finally { note("f"); } note("end"); }
function catchBreaksPastNormalBlock(fail) { a: try { if (fail) throw 1; note("n"); } catch (e) { note(e); break a; } finally { note("f"); } note("end"); }
function blockAndCatchBreak(fail) { a: try { if (fail) throw 1; break a; } catch (e) { note(e); break a; } finally { note("f"); } note("end"); }
function routedReturn(fail) { try { throw 1; } catch (e) { return 2; } finally { note("f"); } }
var forms = [catchBreaksTry, blockBreaksTry, catchBreaksLoop, catchBreaksBlock, breakPastDeadCode, breakInsideLoop, throughTwoFinally, breakOrReturn, nestedInTry, catchRejoinsThenTail, breakBesideNormalEnd, catchBreaksPastNormalBlock, blockAndCatchBreak, routedReturn];
window.TEST_OUTPUT = [];
for (var index = 0; index < forms.length; index++) {
  for (var k = 0; k < 2; k++) {
    log = [];
    var outcome;
    try { outcome = ["value", forms[index](k === 1)]; } catch (error) { outcome = ["thrown", error.message]; }
    window.TEST_OUTPUT.push([index, k, outcome, log]);
  }
}
