var log = [];
function normal() { try { log.push("try"); return "normal"; } finally { log.push("finally"); } }
function caught() { try { throw "boom"; } catch (error) { log.push(error); } finally { log.push("finally-catch"); } }
function nested() { try { try { throw "deep"; } finally { log.push("inner-finally"); } } catch (error) { log.push("nested-caught-" + error); } finally { log.push("outer-finally"); } }
function loopAbrupt() { for (var i = 0; i < 3; i++) { try { if (i === 1) continue; if (i === 2) break; log.push("loop-body-" + i); } finally { log.push("loop-finally-" + i); } } }
var first = normal(); var second = caught(); nested(); loopAbrupt();
window.TEST_OUTPUT = [first, second, log];
