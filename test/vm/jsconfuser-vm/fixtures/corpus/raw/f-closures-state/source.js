function factory() { var count = 0; return function () { count++; return count; }; }
var next = factory();
window.TEST_OUTPUT = [next(), next(), next()];
