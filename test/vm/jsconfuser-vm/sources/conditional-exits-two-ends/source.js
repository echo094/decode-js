function f(a, x, y) { var t = []; L1: { L2: { if (a) { if (x) break L2; if (y) break L1; } t.push(2); } t.push(1); } t.push(0); return t; }
window.TEST_OUTPUT = [f(1, 0, 0), f(1, 1, 0), f(1, 0, 1), f(0, 1, 1)];
