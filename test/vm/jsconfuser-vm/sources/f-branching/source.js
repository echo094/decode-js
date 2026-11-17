var n = 3;
var branch;
if (n > 4) branch = "high"; else if (n > 2) branch = "mid"; else branch = "low";
var nested = n % 2 === 1 ? "odd" : "even";
window.TEST_OUTPUT = [branch, nested];
