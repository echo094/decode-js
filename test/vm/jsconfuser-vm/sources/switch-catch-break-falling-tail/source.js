function h(x, t) { var out = []; switch (x) { case 3: try { if (t) throw 1; out.push(1); } catch (e) { out.push(2); break; } out.push(3); default: out.push(4); } return out; }
window.TEST_OUTPUT = [h(3, 0), h(3, 1), h(0, 0)];
