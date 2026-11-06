function f(x, t) { var out = []; switch (x) { case 1: try { if (t) throw 1; out.push(2); } catch (e) { out.push(3); break; } out.push(4); case 2: out.push(5); } out.push(7); return out; }
window.TEST_OUTPUT = [f(1, 0), f(1, 1), f(2, 0), f(3, 0)];
