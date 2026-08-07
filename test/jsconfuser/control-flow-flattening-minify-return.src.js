function makeCounter(start) {
  let count = start;
  function inc(step) {
    count += step;
    return count;
  }
  function reset() {
    count = start;
    return count;
  }
  return { inc: inc, reset: reset };
}
var c = makeCounter(10);
console.log(c.inc(5));
console.log(c.inc(2));
console.log(c.reset());
