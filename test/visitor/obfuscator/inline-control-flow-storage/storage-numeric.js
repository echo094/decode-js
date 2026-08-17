function read() {
  var storage = {
    zero: 0,
    answer: 42
  };
  return storage.answer + storage.zero;
}
console.log(read());
