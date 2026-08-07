function foo() {
  return 1;
}
const arr = [1, foo()];
console.log(arr[0]);