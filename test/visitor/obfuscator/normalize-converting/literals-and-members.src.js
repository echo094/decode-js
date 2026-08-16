(function () {
  var flag = true, off = false, n = 1000, s = 'abcdefgh';
  var o = { name: 'widget', size: 3 };
  process.stdout.write(o.name + ' ' + o['size'] + ' ' + flag + ' ' + off + ' ' + n + ' ' + s + '\n');
})();
