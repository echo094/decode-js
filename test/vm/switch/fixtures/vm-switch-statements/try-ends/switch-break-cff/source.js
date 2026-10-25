function g(i) { if (i === 3) throw new Error("x"); }
function f(x) { var out = []; switch (x) { case 1: try { g(x); if (x === 1) break; out.push(2); } catch (e) { out.push(3); } out.push(4); case 2: out.push(5); break; default: out.push(6); } out.push(7); return out; }
window.TEST_OUTPUT = [f(1), f(2), f(9)];
