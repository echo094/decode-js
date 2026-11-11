var o = { a: 1 }, f = Object.freeze({ k: 1 }), s = "text", seen = [];
seen.push(delete o.a, delete o["b"], delete f.k, delete s.length, delete s[0], delete s.other, delete (1).x);
try {
  var u;
  seen.push(delete u.x);
} catch (error) {
  seen.push(error.name);
}
window.TEST_OUTPUT = seen;
