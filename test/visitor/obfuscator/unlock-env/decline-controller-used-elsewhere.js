// The controller has one guard, but something else in the program also calls it. Deleting it would
// break that caller, so the pass declines rather than logging and deleting anyway.
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
var guard = controller(this, function () {
  return guard.toString().search('(((.+)+)+)+$').toString().constructor(guard).search('(((.+)+)+)+$');
});
guard();
var mine = controller(null, function () {
  return 'application code';
});
console.log(typeof mine);
