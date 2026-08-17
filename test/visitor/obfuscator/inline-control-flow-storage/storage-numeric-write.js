function read() {
  var storage = {
    zero: 0,
    answer: 42
  };
  storage.answer = 7;
  return storage.answer + storage.zero;
}
console.log(read());
