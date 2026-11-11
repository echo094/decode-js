var breakCount = 0;
outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { breakCount++; if (j === 1) break outer; } }
var continueCount = 0;
outer2: for (var x = 0; x < 3; x++) { for (var y = 0; y < 3; y++) { if (y === 1) continue outer2; continueCount++; } }
window.TEST_OUTPUT = [breakCount, continueCount];
