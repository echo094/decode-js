var object = { base: 10, make: function () { return (value) => this.base + value + arguments[0] + (arguments[1] || 0); } };
var first = object.make(1, 2);
var second = object.make(3);
window.TEST_OUTPUT = [first.call({ base: 100 }, 5), second.call(null, 2)];
