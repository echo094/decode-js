var log = [];
function loopAbrupt() { for (var i = 0; i < 3; i++) { try { if (i === 1) continue; if (i === 2) break; log.push("loop-body-" + i); } finally { log.push("loop-finally-" + i); } } }
loopAbrupt();
window.TEST_OUTPUT = [log];
