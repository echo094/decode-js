var log = [];
function run() { try { log.push("try"); return 1; } finally { log.push("finally"); } }
window.TEST_OUTPUT = [run(), log];
