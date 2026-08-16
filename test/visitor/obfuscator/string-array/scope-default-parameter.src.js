const foo = 'foo'

function test (bar = 'bar') {
    const baz = 'baz'
}

process.stdout.write(String(foo + test()) + '\n');
