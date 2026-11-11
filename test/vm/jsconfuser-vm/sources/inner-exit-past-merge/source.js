function f(a, x) { var t = []; L1: { L2: { if (a) { if (x) break L2; else break L1; } t.push(2); } t.push(1); } t.push(0); return t; }
function g(a, x) { var t = []; L1: { if (a) { if (x) t.push(3); else break L1; } else t.push(2); t.push(1); } t.push(0); return t; }
window.TEST_OUTPUT = [f(1, 0), f(1, 1), f(0, 0), g(1, 0), g(1, 1), g(0, 0)];
