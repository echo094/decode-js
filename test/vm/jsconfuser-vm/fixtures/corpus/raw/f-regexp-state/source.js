var re = /a/g;
var first = re.test("a");
var afterFirst = re.lastIndex;
var second = re.test("a");
var afterSecond = re.lastIndex;
var fresh = [/x/g.test("x"), /x/g.test("x")];
window.TEST_OUTPUT = [first, afterFirst, second, afterSecond, fresh];
