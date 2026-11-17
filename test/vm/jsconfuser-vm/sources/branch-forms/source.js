function pick(flag) {
  var picked = []
  if (flag) picked.push('a')
  else picked.push('b')
  return picked
}

function route(n, skip) {
  var trail = []
  done: {
    switch (n) {
      case 1:
        if (skip) break done
        break
      case 2:
        trail.push(2)
        break
      default:
        trail.push(3)
    }
    trail.push('tail')
  }
  return trail
}

window.TEST_OUTPUT = [pick(true), pick(false), route(1, true), route(1, false), route(2, false), route(3, false)]
