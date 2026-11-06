function f(d, c) { var t = []; L: { if (d) break L; try { if (c.k) break L; c.x.y; t.push("x"); } catch (e) { t.push("e"); } t.push("tail"); } t.push("end"); return t; }
window.TEST_OUTPUT = [f(1, {}), f(0, { k: 1 }), f(0, {}), f(0, { x: { y: 1 } })];
