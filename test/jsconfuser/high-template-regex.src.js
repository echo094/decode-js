var subject = "world"
var greeting = `hello ${subject}!`
var pattern = /h(e)l+o/gi
var hit = greeting.match(pattern)
TEST_OUTPUT = [greeting, hit[0], pattern.source, pattern.flags]
