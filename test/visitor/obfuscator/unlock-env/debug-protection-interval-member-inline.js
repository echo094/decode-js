(function () {
  var _0x28c4c9;
  try {
    var _0x3812eb = Function("return (function() {}.constructor(\"return this\")( ));");
    _0x28c4c9 = _0x3812eb();
  } catch (_0x3f0095) {
    _0x28c4c9 = window;
  }
  _0x28c4c9.setInterval(_0x34740b, 4000);
})();
function classify(_0x186908) {
  if (_0x186908 < 0) {
    return "neg";
  } else {
    if (_0x186908 === 0) {
      return "zero";
    }
  }
  return "pos";
}
var acc = 0;
for (var i = 0; i < 5; i++) {
  if (i % 2 === 0) {
    acc += i;
  } else {
    acc -= i;
  }
}
var label;
switch (acc) {
  case 2:
    label = "two";
    break;
  case 6:
    label = "six";
    break;
  default:
    label = "other";
}
console.log("console-channel");
process.stdout.write(label + " " + acc + "\n");
process.stdout.write(classify(-1) + " " + classify(0) + " " + classify(1) + "\n");
function _0x34740b(_0x4587f9) {
  function _0x1db3eb(_0x14fea9) {
    if (typeof _0x14fea9 === "string") {
      return function (_0x3beee3) {}.constructor("while (true) {}").apply("counter");
    } else {
      if (("" + _0x14fea9 / _0x14fea9).length !== 1 || _0x14fea9 % 20 === 0) {
        (function () {
          return true;
        }).constructor("debugger").call("action");
      } else {
        (function () {
          return false;
        }).constructor("debugger").apply("stateObject");
      }
    }
    _0x1db3eb(++_0x14fea9);
  }
  try {
    if (_0x4587f9) {
      return _0x1db3eb;
    } else {
      _0x1db3eb(0);
    }
  } catch (_0x49e3c0) {}
}
