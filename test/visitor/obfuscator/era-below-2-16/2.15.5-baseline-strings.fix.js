function greet(_0x272a83) {
  return "hello, " + _0x272a83 + '!';
}
var parts = ["alpha", "beta", "gamma"];
var joined = parts.join('-');
var upper = joined.toUpperCase();
console.log("console-channel");
process.stdout.write(greet("world") + '\x0a');
process.stdout.write(joined + '\x20' + upper + '\x20' + parts.length + '\x20' + "literal".charAt(0) + '\x0a');