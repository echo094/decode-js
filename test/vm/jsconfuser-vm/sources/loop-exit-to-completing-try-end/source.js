var log = [];
function f(n) { a: try { for (var i = 0; i < 2; i++) { if (i === n) break a; log.push(i); } log.push("after"); } catch (e) { log.push(e); } finally { log.push("f"); } log.push("end"); }
f(1); f(9);
window.TEST_OUTPUT = [log];
