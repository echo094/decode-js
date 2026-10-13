var log = [];
function hit(value) { log.push(value); return value; }
var andValue = false && hit("and");
var orValue = true || hit("or");
var nullValue = null ?? hit("null");
var zeroValue = 0 ?? hit("zero");
window.TEST_OUTPUT = { values: [andValue, orValue, nullValue, zeroValue], log: log };
