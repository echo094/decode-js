var t = [];
L: { try { if (t.length === 0) break L; t.push("x"); } finally { t.push("f"); } t.push("tail"); }
t.push("end");
window.TEST_OUTPUT = t;
