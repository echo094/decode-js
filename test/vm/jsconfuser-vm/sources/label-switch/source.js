var trace = [];
var n = 0;
outer: switch (n) {
  case 0:
    for (var i = 0; i < 3; i++) {
      if (i === 1) break outer;
      trace.push(i);
    }
    trace.push("unreached");
}
trace.push("end");
window.TEST_OUTPUT = [trace];
