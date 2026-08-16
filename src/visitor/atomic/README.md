# `visitor/atomic/`

Single-rewrite, plugin-agnostic Babel visitors. One file does one thing to one node shape, so a
plugin composes the ones it needs instead of inheriting a bundle.

Each file exports:

- a **default** plain visitor object, for `traverse(ast, visitorDefault)`;
- a named **`create…(onChange)`** factory, for a caller that needs to know whether the visitor
  fired — which a fixpoint loop does, since it has to decide whether to run another round.

## What belongs here

A visitor that is **not specific to any obfuscator**: it recognises a JavaScript shape and
rewrites it to an equivalent one. If a rewrite needs to know which encoder produced the input,
it belongs in that plugin's own folder (`visitor/obfuscator/`, `visitor/jsconfuser/`) instead.

**A readability rewrite qualifies only if a later matcher navigates by the shape it produces.** The
test is "does something downstream read this", never "is it prettier": folding `!![]` to `true`
earns its place because a branch spelled as a unary chain cannot be pruned, so the fold is what
lets the pruning and un-flattening passes see it. The same test excludes turning concatenation back
into a template literal — nothing downstream reads template literals, so it is style, and it is
deliberately unbuilt.

Scheduling does not belong here either. Which visitors run, in what order, and how many times is
a property of the pipeline that consumes them — see `visitor/obfuscator/normalize-statements.js`
for a worked example, where the order within a round is load-bearing and the loop runs to a
fixpoint because the rewrites unlock each other.

## Two rules every visitor here follows

- **Gate on position, and decline rather than stop.** Several of these rewrites are only valid
  where the node is a *statement* rather than a *value*; the parent test is the whole safety
  argument and each file states its own. A node that fails the gate is skipped and traversal
  continues. Never `path.stop()` — it halts the entire traversal, not the subtree, and on
  obfuscated input the declined sites outnumber the matched ones by roughly two to one, so
  stopping at the first would abort the pass before it did any work.
- **Say what is *not* handled, and why.** `lint-logical-if.js` declining `||`, and
  `convert-conditional-assign.js` declining a `VariableDeclarator`, are decisions with reasons —
  recorded so the next reader does not "fix" them.

## Relationship to the visitors in `visitor/`

The flat files one level up (`lint-if-statement.js`, `split-sequence.js`,
`split-variable-declaration.js`, `delete-extra.js`, …) are atoms by the same definition and
predate this folder. They are **not** moved, because every existing plugin imports them by path
and relocating them would touch code this work is meant to leave alone. Migrating them is a
worthwhile refactor on its own terms and belongs in its own commit, not smuggled into a feature.
