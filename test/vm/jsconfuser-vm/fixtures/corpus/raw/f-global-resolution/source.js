var missing = null;
try { definitely_missing_global; } catch (error) { missing = [error.name, error instanceof ReferenceError]; }
try { definitely_missing_global; } catch (error) {}
window.TEST_OUTPUT = [missing, typeof definitely_missing_global];
