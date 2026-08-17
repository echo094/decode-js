(function () {
  var holder = typeof global !== 'object' ? global : this;
  holder.setInterval(debugProtection, 1);
})();
console.log('service-worker-boundary');
function debugProtection(value) {
  function recurse(counter) {
    if (typeof counter === 'string') {
      return function () {}.constructor('while (true) {}').apply('counter');
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
