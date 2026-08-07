# Decoding JS-Confuser output

`-t jsconfuser` (`npm run dejsc`) reverses output from
[JS-Confuser](https://github.com/MichaelXF/js-confuser) 2.x, up to and including the
`high` preset. The pre-2.0 `AntiTooling` shape is still recognized as well, for
real-world samples predating the 2.0 rewrite that removed it.

The target is a fixed sequence of AST passes, each reversing one JS-Confuser transform or
a piece of one. Several transforms are visited more than once: a transform that runs
*early* on the encode side has its output reshaped by every later encode stage, so its
decode pass often cannot match anything until the layers above it have come off.

## What is reversed

**Wrappers.** `Pack`'s eval wrapper, `RGF`'s eval-wrapped sub-programs — decoded
recursively through this same pipeline — and `Integrity`'s hash-guarded functions.

**Control flow.** `ControlFlowFlattening`'s state-vector switch interpreters,
`ControlFlowGraph`, `Dispatcher`, and `Flatten`.

**Strings and literals.** `StringConcealing`, `StringCompression`, `StringSplitting`,
`DuplicateLiteralsRemoval`, and `GlobalConcealing`. `Finalizer`'s hex and escape
re-spelling (`0x1a`, `"\x48"`) is undone too — the parser preserves the raw source
spelling of a literal and the generator prefers it, so these print back out unchanged
unless something removes it explicitly.

**Data flow.** `VariableMasking`, `MovedDeclarations`, `Calculator`,
`ExpressionObfuscation`, and the padding `preserveFunctionLength` adds.

**Guards and noise.** `OpaquePredicates`, `DeadCode`, `AstScrambler`, and all six `Lock`
features — antiDebug, selfDefending, dateLock, domainLock, tamperProtection, and
`invokeCountermeasures` cleanup.

Decoding a concealed string or a masked variable slot means evaluating the obfuscator's
own runtime helper, which happens inside an [isolated-vm](https://github.com/laverdet/isolated-vm)
sandbox rather than in this process.

## What is not reversed

Three transforms destroy information rather than hide it, so there is nothing to
reconstruct:

* **`RenameVariables`** and **`RenameLabels`** — a mangled name is drawn from a generator
  with no relationship to the name it replaced. Nothing in the output records the
  original.
* **`ObjectExtraction`** — it leaves no structural trace at all. `obj.a` becomes a bare
  identifier reference, indistinguishable after renaming from any other local, and
  nothing marks a group of loose variables as having once been one object.

**`Minify`** needs no reversal of its own: its literal shortenings (`!0`, `void 0`,
`1/0`) and merged `var` declarations are undone by passes shared with the other targets,
and everything else it does is formatting or dead-code removal with nothing to recover.

## Limits

* An `ObjectExtraction` decoder would have something to work with only if
  `renameVariables` were explicitly disabled, since the placeholder naming would then
  survive into the output. That is a non-default configuration and is not implemented.
* `Finalizer` can leave a `__JS_CONFUSER_VAR__(id)` marker call when `RenameVariables` is
  disabled. It exists purely to clean up after renaming rather than to obscure anything,
  so it is left alone.
