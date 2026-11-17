var add = (a, b) => a + b;
var object = (() => ({ x: 1, y: 2 }))();
var doubled = [1, 2, 3].map((value) => value * 2);
window.TEST_OUTPUT = [add(2, 3), object, doubled];
