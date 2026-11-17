var value = 17; TEST_OUTPUT = value;
var nanWrite;
try { NaN = value; nanWrite = "silent"; } catch (error) { nanWrite = "throws"; }
window.TEST_OUTPUT = [TEST_OUTPUT, nanWrite];
