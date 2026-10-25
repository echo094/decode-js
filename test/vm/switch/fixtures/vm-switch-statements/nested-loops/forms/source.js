var out = [];
function forInFor() { var s = 0; for (var i = 0; i < 3; i++) { for (var j = 0; j < 4; j++) { s += j; } } return s; }
function whileInWhile() { var s = 0, i = 0; while (i < 3) { var j = 0; while (j < 4) { s += j; j++; } i++; } return s; }
function doWhileInDoWhile() { var s = 0, i = 0; do { var j = 0; do { s += j; j++; } while (j < 4); i++; } while (i < 3); return s; }
function whileInFor() { var s = 0; for (var i = 0; i < 3; i++) { var j = 0; while (j < 4) { s += j; j++; } } return s; }
function forInWhile() { var s = 0, i = 0; while (i < 3) { for (var j = 0; j < 4; j++) { s += j; } i++; } return s; }
function breakInInner() { var s = 0; for (var i = 0; i < 3; i++) { for (var j = 0; ; j++) { if (j >= 4) break; s += j; } } return s; }
function guardInInner(m) { var s = 0, i, j; for (i = 0; i < m.length; i += 2) { for (j = 0; j < 4; j++) { if (j < 2) s += m[i]; else s -= 1; } } return s; }
out.push(forInFor(), whileInWhile(), doWhileInDoWhile(), whileInFor(), forInWhile(), breakInInner(), guardInInner([1, 2, 3, 4]));
window.TEST_OUTPUT = out;
