function Box(seed) { this.value = seed; }
Box.prototype.add = function (delta) { this.value += delta; return this; };
Box.prototype.read = function () { return this.value; };
var left = new Box(2);
var right = new Box(5);
var leftResult = left.add(3).add(left.value).read();
var rightResult = right.add(1).read();
window.TEST_OUTPUT = [leftResult, rightResult, left.value, right.value];
