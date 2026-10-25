function whileAnd(n) { var i = 0, s = 0; while (i < n && s < 20) { s += i; i++; } return [i, s]; }
function whileOr(n) { var i = 0, s = 0; while (i < n || s < 3) { s += 1; i++; } return [i, s]; }
function forNested(list, limit) { var out = []; for (var k = 0; k < list.length && !(limit && list[k] > limit); k++) { out.push(list[k]); } return out; }
function walkChain(node, stop) { var out = []; for (var p = node; p != null && !(stop && p.v === stop); ) { out.push(p.v); p = p.next; } return out; }
function doWhileOr(n) { var i = 0; do { i++; } while (i < n || i % 2 === 1); return i; }
function nestedCompound(rows) { var total = 0; for (var r = 0; r < rows.length && total < 50; r++) { for (var c = 0; c < rows[r].length && rows[r][c] !== 0; c++) { total += rows[r][c]; } } return total; }
var chain = { v: 1, next: { v: 2, next: { v: 3, next: null } } };
window.TEST_OUTPUT = [whileAnd(3), whileAnd(30), whileOr(0), whileOr(5), forNested([1, 5, 2, 9], 0), forNested([1, 5, 2, 9], 4), walkChain(chain, 0), walkChain(chain, 3), doWhileOr(0), doWhileOr(4), nestedCompound([[1, 2, 0, 9], [30, 40], [5]]), nestedCompound([])];
