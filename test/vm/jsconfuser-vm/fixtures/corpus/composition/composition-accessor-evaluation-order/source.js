var events = [];
function key() { events.push("key"); return "value"; }
var object = {
  _value: 2,
  get value() { events.push("get"); return this._value; },
  set value(next) { events.push("set"); this._value = next; }
};
object[key()] = object.value + (events.push("rhs"), 3);
window.TEST_OUTPUT = { value: object.value, events: events };
