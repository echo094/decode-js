var _0x49c7d0 = {
  flag: true
};
var _0x2be2b2 = {
  name: "widget",
  size: 3,
  nested: _0x49c7d0
};
function _0xc8adcc(_0x519e8c) {
  var _0x1d414f = _0x519e8c;
  return function () {
    _0x1d414f += 1;
    return _0x1d414f;
  };
}
var _0x1d089d = _0xc8adcc(_0x2be2b2.size);
var _0x5779ed = "name";
console.log("console-channel");
process.stdout.write(_0x2be2b2[_0x5779ed] + " " + _0x2be2b2.nested.flag + " " + _0x2be2b2.size + "\n");
process.stdout.write(_0x1d089d() + " " + _0x1d089d() + " " + Object.keys(_0x2be2b2).join(",") + "\n");