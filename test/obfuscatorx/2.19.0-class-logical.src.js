const enabled = true;
class Greeter {
  ["quoted"]() {
    return "class-value";
  }
}
if (enabled) {
  process.stdout.write(new Greeter()["quoted"]() + "\n");
}
