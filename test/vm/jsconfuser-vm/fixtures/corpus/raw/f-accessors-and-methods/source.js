var backing = 1;
var computedKey = "computed";
var object = { get value() { return backing; }, set value(next) { backing = next; }, method() { return this.value; }, [computedKey]: 11 };
object.value = 7;
window.TEST_OUTPUT = [object.value, object.method(), object[computedKey], Object.keys(object).sort()];
