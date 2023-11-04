/**
 * Check the format and decode if possible
 *
 * @param {string} code the encoded code
 * @returns null or string
 */
function getCode(code) {
  // split the code by semicolon
  let blocks = []
  for (let line of code.split(';')) {
    if (line.length && line !== '\n') {
      blocks.push(line)
    }
  }
  if (blocks.length !== 6) {
    console.error('The number of code blocks is incorrect!')
    return null
  }
  // try to get the global variable name
  const line1 = blocks[0].split('=')
  if (line1.length !== 2 || line1[1].indexOf('~[]') === -1) {
    console.error('Cannot find variable name!')
    return null
  }
  // extract the target code
  const target = blocks[5]
  const variable = line1[0]
  const left = `${variable}.$(${variable}.$(${variable}.$$+"\\""+`
  let i = 0
  let s = 0
  while (i < left.length && s < target.length) {
    if (left[i] === target[s]) {
      ++i
    }
    ++s
  }
  const right = '"\\"")())()'
  let j = right.length - 1
  let e = target.length - 1
  while (j >= 0 && e >= 0) {
    if (right[j] === target[e]) {
      --j
    }
    --e
  }
  if (s >= e) {
    console.error('Cannot find the target code!')
    return null
  }
  const selected = target.substring(s, e)
  blocks[5] = `${variable}.$(${variable}.$$+"\\""+${selected}+"\\"")()`
  const result = eval(blocks.join(';'))
  return result
}

/**
 * This encoding method originates from http://utf-8.jp/public/jjencode.html,
 * and it does not change the original code (encoder, not obfuscation).
 */
module.exports = function (code) {
  code = getCode(code)
  if (!code) {
    return null
  }
  return code
}
