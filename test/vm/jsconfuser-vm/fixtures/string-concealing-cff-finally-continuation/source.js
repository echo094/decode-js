var out = [];
for (var i = 0; i < 2; i++) { try { out.push(i); } finally { out.push(-i); } out.push("after" + i); }
window.TEST_OUTPUT = out;
