var x = 1;
var object = { x: 10 };
var result = [x++, ++x, object.x += 5, object.x--, delete object.missing, (x = 3, x * 2)];
window.TEST_OUTPUT = { result: result, x: x, object: object };
