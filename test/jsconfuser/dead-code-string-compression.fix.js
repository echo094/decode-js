var api = {};
api["run"] = function (input, out) {
  for (var i = 0; i < input["length"]; i++) {
    out["push"](input[i]);
  }
  return out;
};
console["log"](api["run"]("abc", [])["join"](""));