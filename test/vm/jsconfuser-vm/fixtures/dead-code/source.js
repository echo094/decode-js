// Dead code after a return: a try/catch and a try/finally the compiler still emits, with calls in
// both, and a finalizer resume nothing reaches.
function deadCatch(x) {
  return x + 1
  try { x = g() } catch (e) { x = 2 }
  return x
}
function deadFinally(x) {
  return x + 1
  try { x = g() } finally { x = 3 }
  return x
}
window.TEST_OUTPUT = [deadCatch(1), deadFinally(1)]
