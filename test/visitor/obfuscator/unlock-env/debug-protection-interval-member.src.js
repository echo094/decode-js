function classify(value) {
  if (value < 0) {
    return 'neg';
  } else if (value === 0) {
    return 'zero';
  }
  return 'pos';
}
var acc = 0;
for (var i = 0; i < 5; i++) {
  if (i % 2 === 0) {
    acc += i;
  } else {
    acc -= i;
  }
}
var label;
switch (acc) {
  case 2:
    label = 'two';
    break;
  case 6:
    label = 'six';
    break;
  default:
    label = 'other';
}
console.log('console-channel');
process.stdout.write(label + ' ' + acc + '\n');
process.stdout.write(classify(-1) + ' ' + classify(0) + ' ' + classify(1) + '\n');
