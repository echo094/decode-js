/**
 * delete ReturnStatement in Program scope
 */
export default {
  ReturnStatement(path) {
    if (!path.getFunctionParent()) {
      path.remove()
    }
  },
}
