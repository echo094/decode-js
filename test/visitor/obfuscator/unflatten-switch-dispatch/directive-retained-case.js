function f() {
  'use strict';

  var o = '3|0|1|2|4'.split('|');
  var i = 0;
  while (true) {
    switch (o[i++]) {
      case '0':
        a();
        continue;
      case '1':
        b();
        continue;
      case '2':
        'use strict';
        continue;
      case '3':
        'use strict';
        continue;
      case '4':
        return c();
    }
    break;
  }
}