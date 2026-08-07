function decodeFn(str) {
  var table = "4q6AYhKx<gR>p[f@\"&|G9w^)?rlCo`/vVa}2(B7t]s*u3yFz8i_d0X;QNmSTJEj15U#Z:c~PL=!HOenWk,bD.%I$M+{";
  var raw = "" + (str || "");
  var len = raw.length;
  var ret = [];
  var b = 0;
  var n = 0;
  var v = -1;
  for (var i = 0; i < len; i++) {
    var p = table.indexOf(raw[i]);
    if (p === -1) continue;
    if (v < 0) {
      v = p;
    } else {
      v += p * 91;
      b |= v << n;
      n += (v & 8191) > 88 ? 13 : 14;
      do {
        ret.push(b & 255);
        b >>= 8;
        n -= 8;
      } while (n > 7);
      v = -1;
    }
  }
  if (v > -1) {
    ret.push((b | v << n) & 255);
  }
  return bufferToString(ret);
}
function getStr(start, length) {
  return decodeFn(strArray["slice"](start, start + length));
}
var strArray = "GrhrCDx,B|(X!vk9O=>RJ#LXzL%K3YL+C_3LtZ?gNt7%gv]7lQ9fODJG9%@g=m`X;6Of@b`GL[cwven54xI_ZNq8=ao8lnbQ84u;x2B1MXapmfygaoc8]la(%JlaB>&!(\"g[bl*EUI#:62u<gG@8gan<];GzjBYjoU44llUBb4nyvwyP4i93JR8matDMxwjdmVD305WeA8kwAfasWHPk7v1MXDhja6UmCsg7hey6a8N3rwYpwP7xznmf8ypWutbEKIPbvDWBiXBUJ3PfHsx6K7dcxqKCZscNXYMPqIpdI18sA9af2JZ1WKxLY0";
function getGlobalRoot() {
  var array = [function () {
    return globalThis;
  }, function () {
    return global;
  }, function () {
    return window;
  }, function () {
    return new Function("return this")();
  }];
  var bestMatch;
  var itemsToSearch = [];
  try {
    bestMatch = Object;
    itemsToSearch["push"](""["__proto__"]["constructor"]["name"]);
  } catch (e) {}
  jU7e6o: for (var i = 0; i < array["length"]; i++) {
    try {
      bestMatch = array[i]();
      for (var j = 0; j < itemsToSearch["length"]; j++) {
        if (typeof bestMatch[itemsToSearch[j]] === "undefined") continue jU7e6o;
      }
      return bestMatch;
    } catch (e) {}
  }
  return bestMatch || this;
}
var __globalObject = getGlobalRoot() || {};
var __TextDecoder = __globalObject["TextDecoder"];
var __Uint8Array = __globalObject["Uint8Array"];
var __Buffer = __globalObject["Buffer"];
var __String = __globalObject["String"] || String;
var __Array = __globalObject["Array"] || Array;
var utf8ArrayToStr = function () {
  var charCache = new __Array(128);
  var charFromCodePt = __String["fromCodePoint"] || __String["fromCharCode"];
  var result = [];
  return function (array) {
    var codePt;
    var byte1;
    var buffLen = array["length"];
    result["length"] = 0;
    for (var i = 0; i < buffLen;) {
      byte1 = array[i++];
      if (byte1 <= 127) {
        codePt = byte1;
      } else if (byte1 <= 223) {
        codePt = (byte1 & 31) << 6 | array[i++] & 63;
      } else if (byte1 <= 239) {
        codePt = (byte1 & 15) << 12 | (array[i++] & 63) << 6 | array[i++] & 63;
      } else if (__String["fromCodePoint"]) {
        codePt = (byte1 & 7) << 18 | (array[i++] & 63) << 12 | (array[i++] & 63) << 6 | array[i++] & 63;
      } else {
        codePt = 63;
        i += 3;
      }
      result["push"](charCache[codePt] || (charCache[codePt] = charFromCodePt(codePt)));
    }
    return result["join"]("");
  };
}();
function bufferToString(buffer) {
  if (typeof __TextDecoder !== "undefined" && __TextDecoder) {
    return new __TextDecoder()["decode"](new __Uint8Array(buffer));
  } else if (typeof __Buffer !== "undefined" && __Buffer) {
    return __Buffer["from"](buffer)["toString"]("utf-8");
  } else {
    return utf8ArrayToStr(buffer);
  }
}
function TEST_FUNCTION(a, b) {
  console[getStr(141, 4)](getStr(145, 14));
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
