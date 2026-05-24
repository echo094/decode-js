function checkPattern(code, pattern) {
  let i = 0
  let j = 0
  while (i < code.length && j < pattern.length) {
    if (code[i] == pattern[j]) {
      ++j
    }
    ++i
  }
  return j == pattern.length
}

export default {
  checkPattern,
}
