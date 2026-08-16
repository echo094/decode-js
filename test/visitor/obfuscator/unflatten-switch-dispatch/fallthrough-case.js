function f() {
  var o = '0|1'.split('|');
  var i = 0;
  while (true) {
    switch (o[i++]) {
      case '0':
        a();
      case '1':
        b();
        continue;
    }
    break;
  }
}