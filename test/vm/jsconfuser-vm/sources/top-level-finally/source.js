var log = [];
try {
  log.push("try");
} finally {
  log.push("finally");
}
log.push("after");
window.TEST_OUTPUT = [log];
