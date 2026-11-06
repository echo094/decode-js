function f(c) { var t = []; L: { try { throw 1; } catch (e) { if (c) break L; } t.push("tail"); } t.push("end"); return t; }
window.TEST_OUTPUT = [f(0), f(1)];
