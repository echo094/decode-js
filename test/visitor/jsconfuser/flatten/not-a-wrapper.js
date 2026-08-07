function helper(config, args) {
  return args[0] + config.extra;
}
function original(...restArgs) {
  var config = {
    extra: 1
  };
  return helper(config, restArgs);
}
TEST_OUTPUT = original(5);