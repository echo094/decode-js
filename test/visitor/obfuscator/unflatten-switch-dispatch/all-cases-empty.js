function f() {
  var o = '1|0'.split('|');
  var i = 0;
  while (true) {
    switch (o[i++]) {
      case '0':
        continue;
      case '1':
        continue;
    }
    break;
  }
}