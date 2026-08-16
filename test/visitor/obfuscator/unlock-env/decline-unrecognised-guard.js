// A calls controller whose guard callback matches none of the four known protections. The wrapper
// alone is not licence to delete: the callback could be anything, so an unrecognised shape is left
// in place where a residue census still counts it.
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
  return 42;
});
guard();
console.log('still here');
