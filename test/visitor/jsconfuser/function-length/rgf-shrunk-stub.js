__p_fnLength(target, 3);
function __p_fnLength(fn, length = 1) {
  Object.defineProperty(fn, "length", {
    "value": length,
    "configurable": false
  });
  return fn;
}
function target() {
  return __rgf_arr[0].apply(this, [__rgf_arr, arguments]);
}
console.log(target["length"]);
