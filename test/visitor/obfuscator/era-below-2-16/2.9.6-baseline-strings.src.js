// strings — string literals, concatenation, member reads. The string array's own input.
// Reports through process.stdout.write, which disableConsoleOutput does not intercept.
// The single console.log is shape material, and its suppression is itself a signal.
function greet(who) { return 'hello, ' + who + '!'; }
var parts = ['alpha', 'beta', 'gamma'];
var joined = parts.join('-');
var upper = joined.toUpperCase();
console.log('console-channel');
process.stdout.write(greet('world') + '\n');
process.stdout.write(joined + ' ' + upper + ' ' + parts.length + ' ' + 'literal'.charAt(0) + '\n');
