function mainDecodeFn(str) {
  var table = ",dp&$=>nqj;le8wtxh6`\"bIRi{T![r|Qy14%+OAWP@SFN~:*g5#o(cGk?7MY/LvB_2.9aD3fVC<u0sX}J)HKUE^Z]zm";
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
function getMainStr(start, length) {
  return mainDecodeFn(strArray["slice"](start, start + length));
}
var strArray = "rUr,kYeLrPsu8}EzL\"&UvH!%L6YzR2IZ(RQ(JRJcD^.VMHg|zqZeP3y+@$NIyC8LQ\"Eat(&HQJYJ5U{Zwv6`nf#])O:rM5b%Wh1DaDf1shc$eIocob2N:8R<3}I{e5O(CFqXeKEYS_#2}3QhuM;7SGj(!}|`&3e,9:K@5@?4|eo}^nqM+>Dj1ET_fS7X@0zP}S?1Q@0S99^e#_uAkH95D;)jIA*}d`l:\"E=6=IbRV.>}2IAYk@6_`BP:i)wTZzCkcJ\"swe_+&I_*ynan>S1#NjF0,tc}Ls~qG)9@>QY?YbLW2xbhnF7BRNYPZQr0J2fxvvUN4wracwvk67txLmbVAnpXuu4uMj8zRI57HhOiV07NmiMu89IQYaGFTMcHebVOKm6fwlYIyZ5Vc5Y1oezOWzcJbGKk3VdMMuysERp7XzLpPmEXDN2bbAT4DwyJkJl4FdAMgOY5igEsL0JNCXkfY7xEMAAOAXrq2alJrPSYS804";
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
  usNrBL: for (var i = 0; i < array["length"]; i++) {
    try {
      bestMatch = array[i]();
      for (var j = 0; j < itemsToSearch["length"]; j++) {
        if (typeof bestMatch[itemsToSearch[j]] === "undefined") continue usNrBL;
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
function OUTER_FUNCTION(a, b) {
  function outerDecodeFn(str) {
    var table = "Cm$0`&SlE=g7?q[nHx;3a1)Kyc,V~WoZ}6G:+r<^d28\"p#shRMt(*T!/%D|P.e@vbQ5>9ujz_YFOkAi]IXfBwNUL4J{";
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
  function getOuterStr(start, length) {
    return outerDecodeFn(strArray["slice"](start, start + length));
  }
  console[getOuterStr(223, 4)](getOuterStr(232, 23));
  function INNER_FUNCTION(c, d) {
    function innerDecodeFn(str) {
      var table = "m58kcpZUe_X!Vu*:T<7>`{qQM6Pgri$9S,hsEWBDn1[wCxy&fa+=O)HY/vKL\"|0R?2d.b(z@tj;%FN~J#3l}G^I]o4A";
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
    function getInnerStr(start, length) {
      return innerDecodeFn(strArray["slice"](start, start + length));
    }
    console[getInnerStr(259, 4)](getInnerStr(270, 27));
    return c + d;
  }
  return INNER_FUNCTION(a, b);
}
TEST_OUTPUT = OUTER_FUNCTION(1, 2);
