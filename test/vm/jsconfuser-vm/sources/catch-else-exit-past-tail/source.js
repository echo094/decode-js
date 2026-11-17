function f(c) { var t = []; L: { try { c.x.y; } catch (e) { if (c.k) { t.push("c"); } else break L; } t.push("tail"); } t.push("end"); return t; }
window.TEST_OUTPUT = [f({ k: 1 }), f({ k: 0 }), f({ x: { y: 1 } })];
