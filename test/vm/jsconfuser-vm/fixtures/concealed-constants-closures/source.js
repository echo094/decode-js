function counter(start) { let value = start; return () => ++value; } const next = counter(3); window.TEST_OUTPUT = [next(), next()];
