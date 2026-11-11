function f(c, b) { var t = []; L: { try { if (b) throw 1; t.push("b"); } catch (e) { if (c) break L; t.push("c"); } t.push("tail"); } t.push("end"); return t; }
window.TEST_OUTPUT = [f(0, 0), f(0, 1), f(1, 1)];
