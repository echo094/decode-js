function __p_dummyFunction() {}
function myFunction() {
  if ("randomProp" in __p_dummyFunction) {
    __p_dead_1();
  }
  function __p_dead_1() {
    doSomethingDead();
  }
  realCode();
}
myFunction();
