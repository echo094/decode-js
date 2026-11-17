var log = [];
function make(n) {
  return function run() {
    try {
      if (n > 1) throw n;
      log.push("ok");
    } catch (error) {
      log.push(error);
    } finally {
      log.push("end");
    }
  };
}
make(1)();
make(2)();
window.TEST_OUTPUT = [log];
