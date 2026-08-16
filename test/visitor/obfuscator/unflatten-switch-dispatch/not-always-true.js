function f(done) {
  var o = '1|0'.split('|');
  var i = 0;
  while (!done) {
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