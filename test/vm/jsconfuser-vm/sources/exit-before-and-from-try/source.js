function f(d, c) { var t = []; L: { if (d) break L; try { if (c) break L; t.push("x"); } finally { t.push("f"); } t.push("tail"); } t.push("end"); return t; }
window.TEST_OUTPUT = [f(1, 0), f(0, 1), f(0, 0)];
