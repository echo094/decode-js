var log = [];
function f() { try { log.push("t"); } finally { log.push("f"); return 2; } }
log.push(f());
window.TEST_OUTPUT = [log];
