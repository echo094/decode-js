(function () {
  const foo = {
    bar: 1,
    get baz() { return 2; },
    set bark(value) { this.stored = value; }
  };
  foo.bark = 9;
  process.stdout.write(foo.bar + ' ' + foo.baz + ' ' + foo.stored + '\n');
})();
