(function () {
  var _0x4e5861 = function () {
    var _0x460468;
    try {
      _0x460468 = Function("return (function() {}.constructor(\"return this\")( ));")();
    } catch (_0x4f0597) {
      _0x460468 = window;
    }
    return _0x460468;
  };
  var _0x56959b = _0x4e5861();
  _0x56959b.setInterval(_0x34740b, 4000);
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
