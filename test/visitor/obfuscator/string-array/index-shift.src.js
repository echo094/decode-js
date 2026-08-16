function test () {
    var foo = 'foo' + 1;
    var bar = 'bar' + 2;
    var baz = 'baz' + 3;

    return foo + bar + baz;
}

test();
process.stdout.write(String(test()) + '\n');
