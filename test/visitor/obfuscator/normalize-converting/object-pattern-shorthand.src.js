(function () {
  const src = { foo: 1, bar: 2, other: 3 };
  const { foo, bar, ...rest } = src;
  process.stdout.write(foo + ' ' + bar + ' ' + JSON.stringify(rest) + '\n');
})();
