function add(a, b) { return a + b; }
function double(value) { return value * 2; }
function before() { return "hoisted"; }
window.TEST_OUTPUT = [add(2, 3), double(4), (function () { return 7; })(), (function (value) { return value; })(undefined), before()];
