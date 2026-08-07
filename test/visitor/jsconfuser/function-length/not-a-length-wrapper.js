function definePropHelper(fn, length) {
  Object.defineProperty(fn, "length", {
    "value": length,
    "writable": false,
    "configurable": true
  });
  return fn;
}
definePropHelper(target, 3);