function add(value) { return this.base + value; }
var first = add.call({ base: 1 }, 5);
var second = add.apply({ base: 2 }, [7]);
var bound = add.bind({ base: 3 });
window.TEST_OUTPUT = [first, second, bound(4)];
