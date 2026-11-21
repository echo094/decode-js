# Contributing

## Code quality

Formatting: Prettier (`npm run format`). ESLint turns off the rules that clash with it
(`eslint-config-prettier`). Test fixtures are not formatted.

### When the limits apply

Code merged into `main` meets the limits below; a working branch need not. Each violation is fixed
by its cause or listed as a known exception. A fix changes no decoded output.

The limits are a floor. Code that meets them and still reads clumsily (a hand-written AST walk, a
chain of `if (x.kind === …)`, a `switch` restating another table) is fixed as a class: find every
instance and decide each, keeping the short and clear ones. One job has one mechanism, the
library's own where the library has one.

### Names and layout

A file, folder, test or suite is named for what it is and grouped by what it does or tests, never
by where it came from; no letter codes or history labels. A layout is judged on its design; the
cost of moving files is not weighed.

### The limits

ESLint core rules over `src/vm/`, `src/plugin/jsconfuser-vm.js` and
`src/plugin/jsconfuser-vm-sequential.js`:

| Rule | Limit |
|---|---|
| `complexity` | 20 |
| `max-depth` | 3 |
| `max-params` | 5 |
| `max-lines-per-function` | 80, blank and comment lines skipped |
| `max-lines` | 500, blank and comment lines skipped |

`complexity` scores each nested function separately; a function built from inner closures is caught
only by its length.

`npm run lint` checks the limits and the dependencies between files and between modules; CI runs it. `npm run lint:fix` applies
ESLint's fixes.

Known exceptions, each disabled at its function with its reason:

| Function | Rule | Why |
|---|---|---|
| `readSelector` (`src/vm/jsconfuser-vm/normalize/analyze-dispatcher-wordcode.js`) | `complexity` | One fixed instruction sequence read backwards; each condition pins one word of it |
| `spreadShape` (`src/vm/switch/values/object-literals.js`) | `complexity` | One call shape; each condition is one part of it |

### Dependencies

A file is one source file. A module is a set of files with one responsibility, and each module is
kept in its own folder, so a check on folders is a check on modules. Over all of `src`, files and
modules depend in one direction, at import and at run time:

- No file imports, directly or through other files, a file that imports it
  (`import-x/no-cycle` from `eslint-plugin-import-x`). Break a cycle by moving what both files
  use into a file both import.
- A file never hands a function to a file it imports: not as an argument, not held by an
  object passed on, not stored in a `this` field an instance carries, and not as methods assigned
  onto a prototype (`local/data-not-functions`, [eslint-rules/data-not-functions.js](eslint-rules/data-not-functions.js)).
  Functions reach a file only through its imports: what a file exports, and what its
  functions return.
- No module imports, directly or through other modules, a module that imports it
  ([scripts/check-folder-cycles.mjs](scripts/check-folder-cycles.mjs)).
  Break a cycle by moving what the modules share into a module of its own that they import; a
  folder whose entry imports its subfolders keeps what they share out of its own top level.
- A handler two files need (the decline handler, a renderer, a lowering) is its own file,
  imported by the file that runs it. Where that import would close a cycle, the work runs in
  another order: the result is computed first and handed over as data.
- Library APIs that take functions (array methods, comparators, Babel visitors) are calls into
  the library.

### Reading a violation

Name the cause before changing the code. A change that only lowers the figure is rejected.

| Cause | Sign | Remedy |
|---|---|---|
| Flat dispatch | An `if`/`else` chain choosing by a name (opcode, node type) | [Dispatch map](#dispatch-map) |
| Pinned-shape proof | A guard of many `&&` conditions, each pinning a word or register | None; split only a function that also does another job |
| Undeclared object | Parameters that stay the same across a loop's calls; closures sharing mutable state | [Stages](#stages-not-a-parameter-bag); a class with one public method when the stages share parameters or state |
| Recomputed context | A scan of every enclosing statement, repeated per block | An index built once |
| Several phases | Steps run in sequence over shared locals; two kinds in one body | One function per phase or kind |
| Repeated logic | The same nested loops in two functions | One helper |

A function returns its results; it never appends to a list it was handed.

### Tips

#### Dispatch map

Replace an `if`/`else` chain that chooses by a name with a frozen map from the name to its handler.
Each handler is scored on its own, and adding a name adds an entry, not a branch. A family that is
already a table generates its entries from that table; a shape several handlers build gets a
helper.

```js
const assign = (destination, value) => ({ kind: 'assign', destination: reg(destination), value })

const LOWERINGS = Object.freeze({
  MOVE: (o) => assign(o[0], { kind: 'register', index: reg(o[1]) }),
  JUMP: (o) => ({ kind: 'jump', target: target(o[0]) }),
  ...Object.fromEntries(
    Object.entries(BINARY).map(([name, operator]) => [
      name,
      (o) => assign(o[0], { kind: 'binary', operator, left: reg(o[1]), right: reg(o[2]) }),
    ]),
  ),
})

function lower(instruction, model) {
  const { name, operands } = instruction
  if (!Object.hasOwn(LOWERINGS, name)) return undefined
  return LOWERINGS[name](operands, model.constants, instruction)
}
```

Look the name up with `Object.hasOwn`, so an inherited key (`constructor`, `toString`) is never
taken for an entry.

#### Stages, not a parameter bag

A function over `max-params` is split into stages, not handed one object holding its parameters. Each
stage takes only the inputs it reads and returns a record; the next stage takes that record. Only
records a stage returns travel between functions.

```js
// Before: one function, every input
findConditionalRegions(blocks, edges, graph, loops, switches, labeled, dom, statements)

// After: each stage reads what it needs
const tests = twoWayTests(blocks, edges, graph, switches)
const enclosing = enclosingStops(tests, loops, switches, statements)
const walk = armWalk(blocks, graph)
const { conditionals, labeled: rows } = closeConditionals(tests, enclosing, walk, labeled, dom)
```

A stage whose input is the same on every call of a loop runs once, before the loop.

When the stages take mostly the same parameters, or share mutable state, they become methods of a
class that holds those values, and one public method runs them in sequence. A caller makes that
one call.

```js
const settled = new Settlement(wordcode, { suspects, suspectRuns, originPcMap }).settle(container)
```

### Where it is configured

- `eslint.config.mjs`
- `eslint-rules/`: rules of this project
- `scripts/check-folder-cycles.mjs`: the folder dependencies
- `package.json`: `lint`, `format`
- `.github/workflows/test.yml`
