var values = [];
for (var i = 0; i < 6; i++) { if (i === 2) continue; if (i === 5) break; values.push(i); }
var nested = 0;
for (var r = 0; r < 3; r++) { for (var c = 0; c < 3; c++) { nested++; if (c === 1) break; } }
window.TEST_OUTPUT = [values, nested];
