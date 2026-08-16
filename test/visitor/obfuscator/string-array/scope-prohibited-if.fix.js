if (!![]) {
  var foo = "foo";
}
process["stdout"]["write"](String(foo) + '\x0a');