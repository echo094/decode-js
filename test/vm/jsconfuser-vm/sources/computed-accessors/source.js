var name = "dyn";
var acc = {
  stored: 2,
  get [name + "Get"]() { return this.stored * 10; },
  set [name + "Set"](v) { this.stored = v; },
  [name + "Method"]() { return this.stored + 1; },
};
acc.dynSet = 4;
window.TEST_OUTPUT = [acc.dynGet, acc.dynMethod()];
