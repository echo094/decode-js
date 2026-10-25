function pick(x) { var out = []; switch (x) { case 1: out.push("one"); break; case 2: out.push("two"); case 3: out.push("three"); break; default: out.push("default"); } return out; }
function group(x) { var out = []; switch (x) { case 1: case 2: out.push("low"); break; default: out.push("other"); case 3: out.push("three"); } return out; }
function walk(n) { var out = []; for (var i = 0; i < n; i++) { switch (i) { case 0: out.push("a"); case 1: out.push("b"); break; case 2: continue; default: out.push("d"); } out.push(i); } return out; }
window.TEST_OUTPUT = [pick(1), pick(2), pick(3), pick(4), group(1), group(2), group(3), group(4), walk(5)];
