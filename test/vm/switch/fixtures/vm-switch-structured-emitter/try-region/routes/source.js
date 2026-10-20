var trace = [];
function scenario(options) {
  var count = 10;
  var host = {
    get body() { trace.push("body:get"); if (options.bodyThrows) throw new SyntaxError("body"); return 0; },
    method: function (value) { trace.push(["method", value]); return 100; },
    get handler() {
      trace.push("catch:get");
      if (options.catchGetterThrows) throw new TypeError("catch getter");
      return function (error) { trace.push(["catch", error.name]); if (options.catchCallThrows) throw new Error("catch call"); return 200; };
    }
  };
  function finalize(value) { trace.push(["finally", value]); if (options.finalizerThrows) throw new RangeError("finalizer"); }
  function region(branch) {
    trace.push(["join", branch ? "right" : "left"]);
    try {
      host.body;
      host.method(7);
      return ++count - 10;
    } catch (error) {
      host.handler(error);
      return ++count - 10;
    } finally {
      finalize(count);
    }
  }
  var result, thrown = null;
  try { result = region(options.branch); } catch (error) { thrown = error.name + ":" + error.message; }
  return [result, thrown, count];
}
var cases = [
  { branch: false }, { branch: true },
  { branch: false, bodyThrows: true }, { branch: true, bodyThrows: true },
  { bodyThrows: true, catchGetterThrows: true },
  { branch: true, bodyThrows: true, catchCallThrows: true },
  { branch: true, finalizerThrows: true },
  { bodyThrows: true, catchCallThrows: true, finalizerThrows: true }
];
window.TEST_OUTPUT = cases.map(function (item) { trace = []; var outcome = scenario(item); return [outcome, trace]; });
