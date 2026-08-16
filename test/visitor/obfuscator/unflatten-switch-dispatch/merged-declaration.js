function f() {
  var o = '1|0|2'.split('|'),
    i = 0;
  while (true) {
    switch (o[i++]) {
      case '0':
        b();
        continue;
      case '1':
        a();
        continue;
      case '2':
        return c();
    }
    break;
  }
}