function f(x) {
  if (x) {
    var o = '1|0'.split('|');
    var i = 0;
  }
  while (true) {
    switch (o[i++]) {
      case '0':
        a();
        continue;
      case '1':
        b();
        continue;
    }
    break;
  }
}