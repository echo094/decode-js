var log = [];
function normal() { try { log.push("try"); return "normal"; } finally { log.push("finally"); } }
var first = normal();
window.TEST_OUTPUT = [first, log];
