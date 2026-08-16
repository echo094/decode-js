function test() {
  const c = "foo";
  const d = "bar";
  const e = "baz";
}
process["stdout"]["write"](String(test()) + '\x0a');