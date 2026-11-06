function greet(name = "World") { return "Hello, " + name + "!"; }
function collect(a, b) { return [arguments.length, a, b]; }
window.TEST_OUTPUT = [greet(), greet("Ada"), collect(1, 2), collect(1)];
