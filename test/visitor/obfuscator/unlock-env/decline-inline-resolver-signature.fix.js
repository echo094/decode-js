(function () {
  var holder;
  try {
    var get = Function("return (function() {}.constructor(\"return this\")( ));", 'extra');
    holder = get();
  } catch (error) {
    holder = window;
  }
})();
