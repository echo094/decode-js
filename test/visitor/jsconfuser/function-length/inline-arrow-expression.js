function __p_fnLength(fn, length = 1) {
  Object.defineProperty(fn, "length", {
    "value": length,
    "configurable": false
  });
  return fn;
}
var target = __p_fnLength((...__p_varMask) => {
  __p_varMask["length"] = 3;
  return __p_varMask[0] + __p_varMask[1] + __p_varMask[2];
}, 3);
console.log(target["length"]);
