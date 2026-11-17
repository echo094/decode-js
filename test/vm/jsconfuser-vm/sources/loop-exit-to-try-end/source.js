var log = [];
function f() { a: try { for (var i = 0; i < 2; i++) { if (i) break a; log.push(i); } throw 1; } catch (e) { log.push(e); } finally { log.push("f"); } log.push("end"); }
f();
window.TEST_OUTPUT = [log];
