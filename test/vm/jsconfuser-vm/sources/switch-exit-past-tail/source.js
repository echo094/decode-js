function f(n, c) { var t = []; L: { switch (n) { case 1: if (c) break L; break; case 2: t.push(2); break; default: t.push(3); } t.push("tail"); } return t; }
window.TEST_OUTPUT = [f(1, true), f(1, false), f(2, false), f(3, false)];
