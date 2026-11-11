function g(x) { if (x === 2) throw new Error("x"); }
function loopReturn(n) { for (var i = 0; i < n; i++) { if (i === 2) return i * 10; } return -1; }
function loopBreak() { var s = 0; for (var j = 0; ; j++) { if (j >= 4) break; s += j; } return s; }
function loopCatchBreak() { var n = 0; for (var i = 0; i < 4; i++) { try { g(i); n += i; } catch (e) { n += 100; break; } } return n; }
function catchReturn(x) { try { g(x); } catch (e) { return 5; } return 6; }
window.TEST_OUTPUT = [loopReturn(1), loopReturn(5), loopBreak(), loopCatchBreak(), catchReturn(0), catchReturn(2)];
