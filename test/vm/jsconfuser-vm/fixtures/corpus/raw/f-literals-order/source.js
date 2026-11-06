var index = 0;
function mark(value) { return [value, index++]; }
window.TEST_OUTPUT = {
  bool: mark(true), number: mark(42), nan: mark(NaN),
  infinity: mark(Infinity), undef: mark(undefined),
  array: [mark("a"), mark(null)],
  object: { x: mark(-0), y: mark("z") },
};
