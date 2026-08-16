function f() {
  var o = '2|0|3|1'.split('|');
  var i = 0;
  while (true) {
    switch (o[i++]) {
      case '0':
        b();
        continue;
      case '1':
        return d();
      case '2':
        a();
        continue;
      case '3':
        c();
        continue;
    }
    break;
  }
}