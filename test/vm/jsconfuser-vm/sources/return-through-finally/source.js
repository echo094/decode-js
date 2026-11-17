let count = 0; function check(value) { try { return value + 1; } finally { count++; } } window.TEST_OUTPUT = [check(4), count];
