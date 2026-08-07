function MathImulPolyfill(opA, opB) {
  opB |= 0;
  var result = (opA & 4194303) * opB;
  if (opA & 4290772992) result += (opA & 4290772992) * opB | 0;
  return result | 0;
}
var imul = Math["imul"] || MathImulPolyfill;
function hashLow(str, seed) {
  var h1 = 3735928559 ^ seed;
  var h2 = 1103547991 ^ seed;
  for (var i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = imul(h1 ^ ch, 2654435761);
    h2 = imul(h2 ^ ch, 1597334677);
  }
  h1 = imul(h1 ^ h1 >>> 16, 2246822507) ^ imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = imul(h2 ^ h2 >>> 16, 2246822507) ^ imul(h1 ^ h1 >>> 13, 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function hashFn(fnObject, seed, regex = new RegExp(" ", "g")) {
  var fnStringed = fnObject["toString"]()["replace"](regex, "");
  return hashLow(fnStringed, seed);
}
function realAdd(a, b) {
  return a + b;
}
function TEST_FUNCTION() {
  var h = TEST_FUNCTION.cache || (TEST_FUNCTION.cache = hashFn(realAdd, 12345));
  if (h === 999999) {
    return realAdd(...arguments);
  } else {}
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
