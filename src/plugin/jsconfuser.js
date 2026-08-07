import { parse } from '@babel/parser'
import generator from '@babel/generator'
import traverse from '@babel/traverse'

import calculateConstantExp from '../visitor/calculate-constant-exp.js'
import deleteExtra from '../visitor/delete-extra.js'
import pruneIfBranch from '../visitor/prune-if-branch.js'
import splitVarDeclaration from '../visitor/split-variable-declaration.js'
import jcAntiTooling from '../visitor/jsconfuser/anti-tooling.js'
import jcAstScramblerInit from '../visitor/jsconfuser/ast-scrambler.js'
import jcCalculatorInit from '../visitor/jsconfuser/calculator.js'
import jcControlFlow from '../visitor/jsconfuser/control-flow.js'
import jcControlFlowGraph from '../visitor/jsconfuser/control-flow-graph.js'
import jcDeadCodeInit from '../visitor/jsconfuser/dead-code.js'
import jcDispatcherInit from '../visitor/jsconfuser/dispatcher.js'
import jcDuplicateLiteralInit from '../visitor/jsconfuser/duplicate-literal.js'
import jcFlatten from '../visitor/jsconfuser/flatten.js'
import jcFuncLengthInit from '../visitor/jsconfuser/function-length.js'
import jcGlobalConcealingInit from '../visitor/jsconfuser/global-concealing.js'
import jcIntegrityInit from '../visitor/jsconfuser/integrity.js'
import jcLockInit from '../visitor/jsconfuser/lock.js'
import jcMovedDeclarationsInit from '../visitor/jsconfuser/moved-declarations.js'
import jcOpaquePredicates from '../visitor/jsconfuser/opaque-predicates.js'
import jcPack from '../visitor/jsconfuser/pack.js'
import jcRgf from '../visitor/jsconfuser/rgf.js'
import jcStringCompression from '../visitor/jsconfuser/string-compression.js'
import jcStringConceal from '../visitor/jsconfuser/string-concealing.js'
import jcVariableMasking from '../visitor/jsconfuser/variable-masking.js'

export default function (code) {
  let ast
  try {
    ast = parse(code, { errorRecovery: true })
  } catch (e) {
    console.error(`Cannot parse code: ${e.reasonCode}`)
    return null
  }
  // Pack
  ast = jcPack(ast)
  // Integrity (must decode before anything reshapes the hashed functions further -
  // Integrity is the encoder's last stage, so this is its least-processed form)
  traverse(ast, jcIntegrityInit())
  // AntiTooling
  traverse(ast, jcAntiTooling)
  // AstScrambler (must run before every other structural decoder below -
  // AstScrambler is one of the last encoder stages (order 29) and merges
  // whatever ExpressionStatements are still standalone at that point into a
  // single no-op call's argument list, including ones other transforms'
  // decoders pattern-match as standalone statements, e.g. ControlFlowFlattening's
  // state assignments and Lock's inserted checks - undo it first so those
  // patterns are whole again)
  traverse(ast, jcAstScramblerInit())
  // Minify (no dedicated decode step: literal shortenings (!0/!1, void 0, 1/0)
  // and merged `var` declarations are already undone below by the generic
  // calculateConstantExp/splitVarDeclaration passes; everything else Minify
  // does is either cosmetic reformatting that reads fine as-is or dead-code
  // elimination with nothing left to recover)
  // MovedDeclarations (two separate rewrites: the generic splitVarDeclaration pass
  // undoes the merged `var` declarations its block-hoisting produces, and
  // deMovedDeclarations undoes its function-parameter packing. Both must run before
  // any pass that identifies structure by looking for a FunctionDeclaration or a
  // declaration-shaped statement - most importantly the ControlFlowFlattening decode
  // below, whose whole application fails closed on a packed `_main`.)
  traverse(ast, splitVarDeclaration)
  traverse(ast, jcMovedDeclarationsInit())
  // DuplicateLiteralsRemoval (must run before anything that matches literal
  // shapes directly - Calculator's operator keys, StringConcealing's slice
  // args, GlobalConcealing's switch keys, etc. - since DuplicateLiteralsRemoval
  // runs after all of them on the encode side and can fold any of their own
  // repeated literals into this array too)
  traverse(ast, jcDuplicateLiteralInit())
  // VariableMasking + the shared FunctionLength helper (preserveFunctionLength
  // can be emitted by Dispatcher/RGF/Flatten/VariableMasking alike)
  traverse(ast, jcFuncLengthInit())
  traverse(ast, jcVariableMasking)
  // StringCompression
  traverse(ast, jcStringCompression)
  // StringConcealing. The dependency pool is created here and handed to every later slot:
  // each visit's own Program-exit sweep is reference-count-gated, so a dependency that is
  // still referenced when one sweep runs has to stay collected for the next one to retry.
  const stringConcealCandidates = new Map()
  traverse(ast, jcStringConceal.deStringConcealingInit(stringConcealCandidates))
  // Calculator (unwraps the {ph}_calc(operator, a, b) dispatch call back to a
  // plain BinaryExpression; the fold to a literal happens in the generic
  // calculate-constant-exp.js pass right below)
  traverse(ast, jcCalculatorInit())
  // StringSplitting
  traverse(ast, calculateConstantExp)
  // VariableMasking (run again)
  traverse(ast, jcVariableMasking)
  // OpaquePredicates
  traverse(ast, jcOpaquePredicates.dePredicateGenInit())
  traverse(ast, calculateConstantExp)
  traverse(ast, pruneIfBranch)
  // DeadCode (matches and removes the whole guard as one self-contained unit -
  // must run after OpaquePredicates above, since OpaquePredicates' own IfStatement
  // wrapping fires generically on every if, including ones DeadCode already
  // inserted - `if(!(x1 in dummy1) && (x2 in dummy2))`, needing OpaquePredicates'
  // own fold to unwrap first before DeadCode's guard is bare again)
  traverse(ast, jcDeadCodeInit())
  // GlobalConcealing
  traverse(ast, jcGlobalConcealingInit())
  // ControlFlowFlattening (the main state-vector/transition-graph mechanism - run before
  // deControlFlowFlatteningStateless below, which targets a separate, minor sub-case
  // unrelated to this one and can still run on whatever this pass doesn't match)
  traverse(ast, jcControlFlowGraph.deControlFlowFlatteningGraphInit())
  traverse(ast, jcControlFlow.deControlFlowFlatteningStateless)
  traverse(ast, calculateConstantExp)
  // DuplicateLiteralsRemoval (again). ControlFlowFlattening is encoder Order 24 and
  // DuplicateLiteralsRemoval Order 22, so CFF runs *after* it and rewrites part of its
  // reference sites into indexes through the CFF state array -
  // `literals[state[0x45] + 0x377]`. Those are unreadable to the early pass above and only
  // become plain numeric literals once the CFF decode and the folding above have run, so
  // the array needs a second visit here. The early pass still has to stay where it is:
  // Calculator, StringConcealing and GlobalConcealing all match literal shapes and run
  // before this point.
  traverse(ast, jcDuplicateLiteralInit())
  // VariableMasking (a third time). VariableMasking is encoder Order 20 and
  // DuplicateLiteralsRemoval Order 22, so the array pass above can be holding this
  // transform's own mask keys - a slot spelled `stk[literals[4]]` rather than
  // `stk["length"]`. Both passes above run before the array resolves, and every such key
  // reads as unmatchable there, so the whole enclosing function is left masked. This pass
  // sees plain keys and is what actually decodes those functions.
  traverse(ast, jcVariableMasking)
  // StringCompression + StringConcealing (again). Same reason DuplicateLiteralsRemoval and
  // VariableMasking above need a second visit, applied to the string layer: on a `high`
  // sample the whole program is still inside the ControlFlowFlattening interpreter when the
  // early string passes run, so no `{ph}_STR_N(start, length)` wrapper exists for them to
  // match yet and they decode nothing at all. The wrappers only become distinct functions
  // once the CFF decode above has run.
  //
  // This has to sit *before* Lock/RGF/Dispatcher/Flatten below rather than at the end of the
  // pipeline: Dispatcher in particular reads its four secret flag/key strings out of the
  // matched dispatcher body and needs them as StringLiterals, which is exactly what these
  // passes produce.
  traverse(ast, jcStringCompression)
  traverse(ast, jcStringConceal.deStringConcealingInit(stringConcealCandidates))
  traverse(ast, calculateConstantExp)
  // Calculator (again), for the same reason - and at the same point in the sequence - as
  // GlobalConcealing below: at its own slot above the dispatch function is still sealed
  // inside the ControlFlowFlattening interpreter, so that pass matched nothing at all on a
  // `high` sample. Not a declining matcher, no candidate. It has to run *after* the fold
  // immediately above, not before it: StringSplitting leaves each case test as a
  // concatenation (`"X6lQ1n" + "\x74"`) and the matcher requires a StringLiteral, so a slot
  // one pass earlier decodes nothing. The BinaryExpression it emits is folded by the next
  // constant-fold pass further down.
  traverse(ast, jcCalculatorInit())
  // GlobalConcealing (again). The early pass at its own slot above matches nothing on a
  // `high` sample: the switch function is still sealed inside the ControlFlowFlattening
  // interpreter there, so no candidate exists at all. Unlike the passes above, though,
  // running it straight after the CFF decode is not enough either - what that decode
  // hands back is `function f(...rest) { var a, b; a = function(){…}; b = function(){…};
  // switch (<member>) { case <call>: … } }`, which fails every gate the matcher has:
  // a rest param rather than one identifier, four statements of string-decode wrappers
  // ahead of the switch, a discriminant that is not the param, and case tests that are
  // still `{ph}_STR_N(a, b)` calls and concatenations rather than StringLiterals.
  //
  // Three passes clear those, in this order, which is what fixes this slot: VariableMasking
  // above unmasks the rest param and the wrappers, StringConcealing above turns the case
  // tests into strings, and the fold directly above collapses the remaining concatenations.
  // Measured on a `high` sample, the candidate shape first appears at StringConcealing's
  // second visit and the full match only after that fold - anywhere earlier is a pass with
  // a zero population, which is what this slot was before.
  //
  // Before the scope-anchor cleanup and Dispatcher below for the reason their own comments
  // give: this removes a Program-level function declaration outright and rewrites every
  // `getGlobal("key")` call to a plain identifier, so it can only shorten the bodies those
  // passes read by shape.
  traverse(ast, jcGlobalConcealingInit())
  // Scope-anchor cleanup. The ControlFlowFlattening decode above flattens every
  // `scope[scopeProperty][varName]` chain to a plain identifier but leaves the statement
  // that created `scope[scopeProperty]` standing with no reader. It cannot be cleaned up
  // where it is produced: deciding an anchor is dead means reading every other member key
  // on the same holder, and until the string passes directly above have run those keys are
  // still `{ph}_STR_N(a, b)` calls and unfolded concatenations, which the pass's own
  // unreadable-key guard treats - correctly - as "might read this property", declining
  // every anchor. Here the keys are plain strings. Before Dispatcher below for the same
  // reason OpaquePredicates/DeadCode are: a surviving anchor is one more statement in the
  // block the dispatcher matcher reads by shape.
  traverse(ast, jcControlFlowGraph.deScopeAnchorCleanupInit())
  // OpaquePredicates + DeadCode (again). Same reason as the passes above, and the same
  // remedy: on a `high` sample both transforms' guards sit inside the ControlFlowFlattening
  // interpreter when the early passes run, so there is no `if ("randomProp" in dummyFn)`
  // statement in the tree for them to visit yet and they remove nothing. The guards only
  // become ordinary statements once the CFF decode above has unwound the interpreter. The
  // early passes still have to stay where they are - they do fire on whatever is already at
  // Program level, and DeadCode's own comment above explains why it must follow
  // OpaquePredicates' fold either way.
  //
  // This sits before Dispatcher below for the ordering reason that motivated it: DeadCode is
  // encoder Order 8 and OpaquePredicates 13, both *later* than Dispatcher's Order 6, so
  // until their guards are gone the dispatcher matcher is reading a body they have padded -
  // every such guard is an extra statement in it, which is exactly what its body-shape check
  // rejects on.
  traverse(ast, jcOpaquePredicates.dePredicateGenInit())
  traverse(ast, calculateConstantExp)
  traverse(ast, pruneIfBranch)
  traverse(ast, jcDeadCodeInit())
  // StringConcealing dependency cleanup, after the last pass that can drop a reference to
  // one. DeadCode's second visit above is the measured case: it removes the decode function
  // whose `return bufferToString(...)` was the sole remaining reference to the whole
  // getGlobal/TextDecoder/utf8 chain, which the sweeps at both StringConcealing slots had
  // therefore - correctly - declined to delete.
  traverse(
    ast,
    jcStringConceal.deStringConcealingCleanupInit(stringConcealCandidates),
  )
  // Lock (all six sub-features: antiDebug, selfDefending, dateLock, domainLock,
  // tamperProtection, and invokeCountermeasures cleanup - run this late, mirroring
  // Flatten below, since Lock runs early on the encode side and its inserted code
  // is reshaped by nearly every later transform)
  traverse(ast, jcLockInit())
  // RGF (recursively decodes each eval-wrapped sub-program with this same
  // pipeline - must run after the index-literal folding above so the array
  // index reads as a plain NumericLiteral)
  traverse(ast, jcRgf)
  // Dispatcher (needs VariableMasking, above, to have already unmasked the
  // dispatcher function's own params if VariableMasking also applies to it)
  traverse(ast, jcDispatcherInit())
  // Second CFF-helper sweep: the Dispatcher decode above removes the dispatcher template,
  // which is routinely the last thing holding a CFF runtime helper's reference count above
  // zero, so a helper the sweep inside the CFF decode had to leave alone only becomes
  // removable here.
  traverse(ast, jcControlFlowGraph.deCffHelperCleanupInit())
  // Flatten
  traverse(ast, jcFlatten)
  // The `<name> = "literal"` half of the StringConcealing placement reversal, deferred to
  // here from the slot above. It deletes the binding it inlines, and Flatten's accessor
  // object records the outer variable it proxies as an identifier inside a getter - so
  // running it earlier erases the only record of that identity and `deFlatten` then declines
  // on the whole scope object. Its siblings stay above, where Dispatcher needs their output.
  traverse(ast, jcStringConceal.deStringConcealingPlaceAssign)
  // Fold what the inlining above just made foldable. Substituting a literal into a
  // concatenation routinely completes one - a template literal Preparation had rewritten to
  // `"a" + x + "b"` becomes all-literal the moment `x` is inlined - and this is the last slot
  // that can catch it, since every other constant-fold pass runs before the inliner now.
  traverse(ast, calculateConstantExp)
  // Finalizer (hexadecimalNumbers/stringEncoding: both just re-escape a
  // literal's raw source text - the parsed VALUE is already identical, but
  // Babel's generator prefers node.extra.raw over the value when present, so
  // it would otherwise print the escaped/hex form back out unchanged)
  traverse(ast, deleteExtra)
  // ExpressionObfuscation
  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
