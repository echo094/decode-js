function Counter(start) { this.value = start; }
function total(limit) {
  var counter = new Counter(0);
  for (var i = 0; i < limit; i++) counter.value += i;
  return counter.value;
}
window.TEST_OUTPUT = total(4) + Math.max(2, 7) * 100;
