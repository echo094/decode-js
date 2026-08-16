function f() {
  if ("abcde" === "abcde") {
    const step = 2;
    let total = step + 1;
    use(total);
  } else {
    dead();
  }
}