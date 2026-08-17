(function () {
  var holder;
  try {
    var get = Function("return (function() {}.constructor(\"return this\")( ));");
    holder = get();
  } catch (error) {
    holder = window;
  }
  console.log('keep-this-effect');
})();
