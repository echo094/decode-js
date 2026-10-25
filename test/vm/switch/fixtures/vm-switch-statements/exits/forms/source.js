function returnInFor(n) { for (var i = 0; i < 5; i++) { if (i === n) return i * 10; } return -1; }
function returnInWhile(n) { var i = 0; while (i < 5) { if (i === n) return i; i++; } return -1; }
function returnInNested(n) { for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (i + j === n) return [i, j]; } } return null; }
function loopThenThrow(n) { var s = 0; for (var i = 0; i < n; i++) { s += i; } throw new Error("s" + s); }
function throwInLoopThenReturn(n) { var s = 0; for (var i = 0; i < 5; i++) { if (i === n) throw new Error("at" + i); s += i; } return s; }
function returnInLoopThenThrow(n) { for (var i = 0; i < 5; i++) { if (i === n) return i; } throw new Error("none"); }
function guard(v) { if (v < 0) throw new Error("neg"); return v + 1; }
function ifElseThenThrow(x) { var y = 0; if (x) { y = 1; } else { y = 2; } throw new Error("y" + y); }
var forms = [returnInFor, returnInWhile, returnInNested, loopThenThrow, throwInLoopThenReturn, returnInLoopThenThrow, guard, ifElseThenThrow];
var inputs = [-1, 0, 2, 9];
window.TEST_OUTPUT = [];
for (var index = 0; index < forms.length; index++) {
  for (var k = 0; k < inputs.length; k++) {
    var outcome;
    try { outcome = ["value", forms[index](inputs[k])]; } catch (error) { outcome = ["thrown", error.message]; }
    window.TEST_OUTPUT.push([index, inputs[k], outcome]);
  }
}
