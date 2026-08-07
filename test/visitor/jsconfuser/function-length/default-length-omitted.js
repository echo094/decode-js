function __p_fnLength(fn, length = 1) {
  Object.defineProperty(fn, "length", {
    "value": length,
    "configurable": false
  });
  return fn;
}
function target(...__p_varMask) {
  __p_varMask["length"] = 1;
  return __p_varMask[0];
}
__p_fnLength(target);
console.log(target["length"]);
