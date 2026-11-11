var log = [];
function note(value) { log.push(value); }
function catchInArm(fail) { if (fail) { try { throw 1; } catch (e) { note(e); } } else { note("n"); } note("m"); }
function catchInArmNoElse(fail) { if (fail) { try { throw 1; } catch (e) { note(e); } } note("m"); }
function catchInBothArms(fail) { if (fail) { try { throw 1; } catch (e) { note(e); } } else { try { throw 2; } catch (e) { note(e); } } note("m"); }
function catchInArmInFinally(fail) { try { if (fail) { try { throw 1; } catch (e) { note(e); } } else { note("n"); } note("m"); } finally { note("f"); } note("end"); }
function catchInLoopArm(fail) { for (var i = 0; i < 3; i++) { if (i) { try { throw i; } catch (e) { if (e > 1) break; note(e); continue; } } note("m" + i); } note("end"); }
function catchInCase(n) { switch (n ? 1 : 2) { case 1: try { throw 1; } catch (e) { note(e); } case 2: note("two"); } note("end"); }
function breakBesideThrow(fail) { a: try { if (fail) break a; note("x"); throw 1; } finally { note("f"); } note("end"); }
function breakBesideThrowInCatch(fail) { a: try { throw 1; } catch (e) { if (fail) break a; note("y"); throw 2; } finally { note("f"); } note("end"); }
function breakBesideThrowInLoop(fail) { for (var i = 0; i < 2; i++) { try { if (fail) break; note("x"); throw 1; } finally { note("f"); } } note("end"); }
function catchRejoinsAtTail(fail) { a: try { if (fail) { note("y"); break a; } throw 1; } catch (e) { note(e); } finally { note("f"); } note("end"); }
var forms = [catchInArm, catchInArmNoElse, catchInBothArms, catchInArmInFinally, catchInLoopArm, catchInCase, breakBesideThrow, breakBesideThrowInCatch, breakBesideThrowInLoop, catchRejoinsAtTail];
window.TEST_OUTPUT = [];
for (var index = 0; index < forms.length; index++) {
  for (var k = 0; k < 2; k++) {
    log = [];
    var outcome;
    try { outcome = ["value", forms[index](k === 1)]; } catch (error) { outcome = ["thrown", error.message]; }
    window.TEST_OUTPUT.push([index, k, outcome, log]);
  }
}
