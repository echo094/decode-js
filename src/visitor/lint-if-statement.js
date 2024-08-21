const t = require('@babel/types')

function LintIfStatement(path) {
  let { test, consequent, alternate } = path.node
  let changed = false
  if (!t.isBlockStatement(consequent)) {
    consequent = t.blockStatement([consequent])
    changed = true
  }
  if (alternate && !t.isBlockStatement(alternate)) {
    alternate = t.blockStatement([alternate])
    changed = true
  }
  if (!changed) {
    return
  }
  path.replaceWith(t.ifStatement(test, consequent, alternate))
}

module.exports = {
  IfStatement: { exit: LintIfStatement },
}
