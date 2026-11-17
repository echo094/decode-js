var t = [];
var c = 1;
L: { M: { try { if (c) break L; if (!c) break M; } finally { t.push("f"); } t.push("tail"); } t.push("m"); }
t.push("end");
window.TEST_OUTPUT = t;
