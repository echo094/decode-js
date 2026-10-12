function outer(prefix) { return function middle(n) { return function inner() { return prefix + ":" + n; }; }; } window.TEST_OUTPUT = outer("id")(7)();
