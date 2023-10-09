const generator = require('@babel/generator').default

module.exports = {
  BinaryExpression(path) {
    const code = generator(path.node).code
    try {
      const ret = eval(code)
      path.replaceWithSourceString(ret)
    } catch {
      //
    }
  },
}
