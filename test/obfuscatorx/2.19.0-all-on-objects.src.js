// objects — object literals, computed member access, closures. Transformer and SplitString.
var config = { name: 'widget', size: 3, nested: { flag: true } };
function makeCounter(start) {
  var n = start;
  return function () { n += 1; return n; };
}
var next = makeCounter(config.size);
var key = 'na' + 'me';
console.log('console-channel');
process.stdout.write(config[key] + ' ' + config.nested.flag + ' ' + config['size'] + '\n');
process.stdout.write(next() + ' ' + next() + ' ' + Object.keys(config).join(',') + '\n');
