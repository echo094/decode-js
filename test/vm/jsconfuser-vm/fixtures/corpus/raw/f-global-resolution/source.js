var missing = null;
try { definitely_missing_global; } catch (error) { missing = [error.name, error instanceof ReferenceError]; }
window.TEST_OUTPUT = [missing, typeof definitely_missing_global];
