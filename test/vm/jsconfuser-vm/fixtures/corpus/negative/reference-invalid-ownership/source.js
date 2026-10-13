function make(seed) { var total = seed; return function (step) { total += step; return total; }; }
var next = make(2);
window.TEST_OUTPUT = [next(1), next(2)];
