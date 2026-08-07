var yLMMv6, grqirZD;
yLMMv6 = function (O2YWEi) {
  var R2WuklJ, TmPzR5, _SLK76;
  R2WuklJ = function () {
    _SLK76 = O2YWEi;
    return _SLK76;
  };
  TmPzR5 = function (_cS0Ie) {
    _SLK76 += _cS0Ie;
    return _SLK76;
  };
  _SLK76 = O2YWEi;
  return {
    ["inc"]: TmPzR5,
    ["reset"]: R2WuklJ
  };
};
grqirZD = yLMMv6(10);
console["log"](grqirZD["inc"](5));
console["log"](grqirZD["inc"](2));
console["log"](grqirZD["reset"]());