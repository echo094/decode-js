function Parent() {}
Parent.prototype.inherited = 1;
var object = new Parent(); object.own = 2;
var keys = []; for (var key in object) keys.push(key);
window.TEST_OUTPUT = { raw: keys, sorted: keys.slice().sort() };
