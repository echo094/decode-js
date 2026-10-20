var caught = null;
try { [] instanceof {}; } catch (error) { caught = [String(error.name), error instanceof TypeError]; }
window.TEST_OUTPUT = caught;
