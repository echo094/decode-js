var holder = {};
var method = "setInterval";
holder[method](debugProtection, 4000);
function debugProtection(value) {
  function recurse(counter) {
    if (typeof counter === "string") {
      return function () {}.constructor("while (true) {}").apply("counter");
    }
    recurse(++counter);
  }
  try {
    if (value) {
      return recurse;
    }
    recurse(0);
  } catch (error) {}
}
