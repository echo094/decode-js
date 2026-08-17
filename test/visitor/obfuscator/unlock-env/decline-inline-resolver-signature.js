(function () {
  var holder;
  try {
    var get = Function("return (function() {}.constructor(\"return this\")( ));", 'extra');
    holder = get();
  } catch (error) {
    holder = window;
  }
  holder.setInterval(debugProtection, 4000);
})();
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
