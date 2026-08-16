# decode-js

An AST analyzer and processor based on Babel that turns obfuscated JavaScript back into
readable source.

## Supported targets

One target per run, selected with `-t`:

| `-t` | target |
|---|---|
| `common` | frequently-seen local obfuscation, not tied to any one tool — unreachable code, nested blocks, constant expressions, raw strings |
| `jjencode` | jjencode, in the variant emitted by sojson.com |
| `sojson` | sojson |
| `sojsonv7` | sojson v7 |
| `obfuscator` | [javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator) (obfuscator.io) |
| `obfuscatorx` | the same obfuscator, version-aware — see below for how it differs |
| `jsconfuser` | [JS-Confuser](https://github.com/MichaelXF/js-confuser) |

### `obfuscator`

* stringArray (including Rotate, Wrappers, and ChainedCalls)
* deadCode
* controlFlowFlattening (switch)
* transformer (ObjectExpression, SplitString, and etc.)
* customCode (self-defending, debug-protection, console-output)

### `obfuscatorx`

The same encoder as `obfuscator`, decoded era by era rather than against one shape. It is an
**additional** target, not a replacement: `obfuscator` is widely depended on and is left untouched,
and the two are expected to disagree on some samples.

Two differences worth knowing before choosing between them:

* **It declines rather than half-decoding.** Where a string-array layer is present and cannot be
  read, this entry returns nothing and says why, instead of emitting a partly-resolved program.
  A layer it does not own is not that case — it returns the partial decode so the output can be
  fed to another target, and logs what it left behind.
* **It reports the encoder era.** The version range is derived from the emitted shape and printed
  after the decode. Emitted output can only identify a *range*, never an exact version, and a
  sample carrying no evidence on an axis is reported as such rather than guessed at.

Coverage is **non-contiguous**: the 2.x eras and the pinned 5.5.0, with 3.0.0–4.2.2 unverified.
A sample whose range overlaps that gap is reported as unknown rather than treated as covered.

### `jsconfuser`

Covers JS-Confuser 2.x up to and including the `high` preset. Which transforms are
reversed, which are not, and why: [docs/jsconfuser.md](docs/jsconfuser.md).

## Usage

**If problems occur during installation and execution, please check the requirements of
[isolated-vm](https://github.com/laverdet/isolated-vm?tab=readme-ov-file#requirements)
first.**

1. Prepare a nodejs environment (26.x — the required version depends on the
   `isolated-vm` version; see its
   [compatibility table](https://github.com/laverdet/isolated-vm?tab=readme-ov-file#compatibility)).

2. Install the dependencies via `npm i`.

3. Run the plugins as follows:

```shell
# pre-defined command
npm run xxx
# or full command
npm run decode -- -t type [-i input.js] [-o output.js] [-v]
```

`xxx` is one of the predefined commands, each a shorthand for one target — `deob`,
`dejsc`, `deso`, `desov7`. See the `scripts` field in [package.json](package.json).

The default input file is `input.js`. The file cannot contain additional codes other
than obfuscated code (such as non-obfuscated code).

The default output file is `output.js`.

`-v` turns on per-pass progress tracing, which is off by default.

## Related Projects

* [cilame/v_jstools](https://github.com/cilame/v_jstools)
* [j4k0xb/webcrack](https://github.com/j4k0xb/webcrack)
* [NXY666/Jsjiemi](https://github.com/NXY666/Jsjiemi)

## License

Copyright (c) 2022 the decode-js contributors.

Licensed under the GNU General Public License, version 3 or later. See
[LICENSE](LICENSE) for the full text.
