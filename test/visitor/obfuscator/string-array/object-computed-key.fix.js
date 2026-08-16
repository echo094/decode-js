var test = {
  ["foo"]: "barbaz"
};
process["stdout"]["write"](String(test["foo"]) + '\x0a');