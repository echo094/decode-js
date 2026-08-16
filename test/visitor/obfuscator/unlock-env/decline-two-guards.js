// A controller with TWO guards on it. Stock javascript-obfuscator never emits this - each helper
// group builds its own controller - so it can only be hand-built, and it is the shape a variant
// encoder that shared one controller would produce. Removing the controller with either guard
// would break the other, so the pass must leave the whole thing alone.
var controller = (function () {
  var first = true;
  return function (context, fn) {
    var r = first ? function () {
      if (fn) {
        var res = fn.apply(context, arguments);
        fn = null;
        return res;
      }
    } : function () {};
    first = false;
    return r;
  };
})();
var guardA = controller(this, function () {
  return guardA.toString().search('(((.+)+)+)+$').toString().constructor(guardA).search('(((.+)+)+)+$');
});
var guardB = controller(this, function () {
  return guardB.toString().search('(((.+)+)+)+$').toString().constructor(guardB).search('(((.+)+)+)+$');
});
guardA();
guardB();
