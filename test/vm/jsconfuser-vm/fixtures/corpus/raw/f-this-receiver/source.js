function Box(value) { this.value = value; }
Box.prototype.get = function () { return this.value; };
var box = new Box(7);
var object = { value: 3, get: function () { return this.value; } };
window.TEST_OUTPUT = [box.get(), object.get(), object.get.call({ value: 9 })];
