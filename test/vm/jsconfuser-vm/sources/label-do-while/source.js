var d = 0;
again: do {
  d++;
  if (d < 3) continue again;
  break again;
} while (true);
window.TEST_OUTPUT = [d];
