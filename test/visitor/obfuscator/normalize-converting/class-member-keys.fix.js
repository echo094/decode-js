class _0x4f1c97 {
  constructor() {
    this.made = "ctor";
  }
  bar() {
    return "bar";
  }
  quoted() {
    return "quoted";
  }
  static make() {
    return new _0x4f1c97();
  }
}
process.stdout.write(_0x4f1c97.make().made + '\x20' + new _0x4f1c97().bar() + '\x20' + new _0x4f1c97().quoted() + '\x0a');