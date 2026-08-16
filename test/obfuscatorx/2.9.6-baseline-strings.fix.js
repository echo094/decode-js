function greet(_0xbc4c9f) {
  return "hello, " + _0xbc4c9f + "!";
}
var parts = ["alpha", "beta", "gamma"];
var joined = parts.join("-");
var upper = joined.toUpperCase();
console.log("console-channel");
process.stdout.write(greet("world") + "\n");
process.stdout.write(joined + " " + upper + " " + parts.length + " " + "literal".charAt(0) + "\n");