// Source dead code under control flow flattening: everything after the return is unreachable,
// with a getter, an arrow closure, enumeration, loops, a switch, nested try/finally/catch, a
// labeled break and a throw. CFF adds its own fake blocks; only those are its to remove.
function deadAll(x) {
  let total = x
  return total + 1
  const o = { a: 1, get b() { return 2 } }
  o.c = x
  delete o.a
  for (const k in o) total += o[k]
  for (let i = 0; i < 3; i++) { if (i === 1) continue; total += i }
  while (total > 100) total--
  switch (total) { case 1: total = 2; break; case 3: total = 4; default: total = 5 }
  const f = () => total + x
  try { try { total = f() } finally { total++ } } catch (e) { total = typeof e }
  label: { if (x) break label; total = -total }
  total = 'k' in o ? new Date(total) : [total, ...[1, 2]]
  throw new Error(String(total))
}
window.TEST_OUTPUT = [deadAll(1)]
