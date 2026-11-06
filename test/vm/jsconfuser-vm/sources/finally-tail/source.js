// A finalizer's body under flattening ends in a transition after its JUMP_REG; selfModifying must
// read that as the body's own code, not as a decoy it planted.
var log = []
function plain() {
  try {
    log.push(1)
  } finally {
    log.push(2)
  }
}
function caught() {
  try {
    throw 3
  } catch (error) {
    log.push(error)
  } finally {
    log.push(4)
  }
  return 5
}
plain()
log.push(caught())
window.TEST_OUTPUT = [log]
