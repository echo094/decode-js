/**
 * delete ReturnStatement in Program scope
 */
module.exports = {
  ReturnStatement(path) {
    if (!path.getFunctionParent()) {
      path.remove()
    }
  },
}
