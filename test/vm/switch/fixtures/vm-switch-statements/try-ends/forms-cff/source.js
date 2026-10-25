var log = [];
function note(value) { log.push(value); }
function normalEnd(fail) { try { if (fail) throw new Error("x"); note("try"); } catch (e) { note("catch"); } note("after"); }
function blockAlwaysThrows(fail) { try { throw new Error("always"); } catch (e) { note("caught " + e.message); } note("after"); }
function finallyNormal(fail) { try { if (fail) throw new Error("x"); note("try"); } finally { note("finally"); } note("after"); }
function finallyReturns(fail) { try { return "returned"; } finally { note("finally"); } }
function breakInTryInLoop(fail) { for (var i = 0; i < 4; i++) { try { if (i === 2) break; note("i" + i); } catch (e) { note("catch"); } note("next"); } note("after"); }
function continueThroughFinally(fail) { for (var i = 0; i < 3; i++) { try { if (i === 1) continue; note("i" + i); } finally { note("f" + i); } note("after" + i); } note("done"); }
function continueToBranchingUpdate(fail) { for (var i = 0; i < 6; i = fail ? i + 2 : i + 1) { try { if (i === 1) continue; note("i" + i); } finally { note("f" + i); } note("after" + i); } note("done"); }
var forms = [normalEnd, blockAlwaysThrows, finallyNormal, finallyReturns, breakInTryInLoop, continueThroughFinally, continueToBranchingUpdate];
window.TEST_OUTPUT = [];
for (var index = 0; index < forms.length; index++) {
  for (var k = 0; k < 2; k++) {
    log = [];
    var outcome;
    try { outcome = ["value", forms[index](k === 1)]; } catch (error) { outcome = ["thrown", error.message]; }
    window.TEST_OUTPUT.push([index, k, outcome, log]);
  }
}
