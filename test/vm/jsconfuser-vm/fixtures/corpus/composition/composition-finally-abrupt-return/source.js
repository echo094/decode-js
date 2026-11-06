var log = [];
function run(flag) {
  try {
    log.push("try-" + flag);
    if (flag) return "returned";
    return "normal";
  } finally {
    log.push("finally-" + flag);
  }
}
var result = run(true);
window.TEST_OUTPUT = [result, log];
