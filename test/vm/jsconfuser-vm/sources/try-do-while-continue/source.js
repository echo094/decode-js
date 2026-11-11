var log = []; function note(v) { log.push(v); }
function f(x) { var i = 0; do { try { if (i === 1) continue; note("i" + i); } finally { note("f" + i); } note("after" + i); } while (++i < 3); note("done"); return i; }
window.TEST_OUTPUT = [f(false), f(true), log];
