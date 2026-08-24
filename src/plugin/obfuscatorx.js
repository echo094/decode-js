import { parse } from '@babel/parser'
import generator from '@babel/generator'
import traverse from '@babel/traverse'

import logger from '../utility/logger.js'
import calculateConstantExp from '../visitor/calculate-constant-exp.js'
import deleteExtra from '../visitor/delete-extra.js'
import pruneIfBranch from '../visitor/prune-if-branch.js'
import normalizeStatements from '../visitor/obfuscator/normalize-statements.js'
import inlineControlFlowStorage from '../visitor/obfuscator/inline-control-flow-storage.js'
import decodeStringArray from '../visitor/obfuscator/string-array.js'
import normalizeConverting from '../visitor/obfuscator/normalize-converting.js'
import { createUnflattenSwitchDispatch } from '../visitor/obfuscator/unflatten-switch-dispatch.js'
import unlockEnv from '../visitor/obfuscator/unlock-env.js'

/**
 * A shape-driven, era-invariant entry for javascript-obfuscator output.
 *
 * **Additive, and the existing `obfuscator` entry is left untouched.** That one is widely depended
 * on, so changing it in place risks breaking people relying on its behaviour; this is a second
 * target rather than a replacement, and the two are expected to disagree.
 *
 * **No version in the name, deliberately.** The same pass pipeline consumes supported shapes
 * regardless of the encoder era. Version and era knowledge belongs in the encoder registry and
 * development corpus, fixtures, and other development records, not in decoder runtime behavior.
 *
 * **The pipeline is era-invariant**: the same passes in the same order for every era. Detection is
 * shape-first and supplies resolved handles rather than an era to a per-era strategy, so there are
 * no per-era strategies here and no runtime version reporting.
 */

/**
 * The fixpoint group. Storage inlining re-opens Converting work that has already reported clean, so
 * these are one group repeated rather than a line run once - a cycle in the dependency order, which
 * a re-cut of pass boundaries cannot remove.
 *
 * `prune-if-branch` is load-bearing three times over: it is the un-flattener's precondition, since
 * dead-code injection copies flattened blocks into scopes that do not hold their controller
 * storage; it is the whole of the dead-code reversal; and it keeps donated helper clones out of the
 * anti-tamper strip's way.
 */
function runGroup(ast, maxRounds = 8) {
  let previous = null
  let rounds = 0
  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1
    normalizeConverting(ast)
    traverse(ast, calculateConstantExp)
    traverse(ast, inlineControlFlowStorage)
    traverse(ast, calculateConstantExp)
    traverse(ast, pruneIfBranch)
    traverse(
      ast,
      createUnflattenSwitchDispatch(() => {}),
    )
    const current = generator(ast, { compact: true }).code
    if (current === previous) break
    previous = current
  }
  return rounds
}

export default function (code) {
  let ast
  try {
    ast = parse(code, { errorRecovery: true, allowReturnOutsideFunction: true })
  } catch (e) {
    logger.error(
      `[obfuscatorx] cannot parse input: ${e.reasonCode ?? e.message}`,
    )
    return null
  }

  // Normalization first: the encoder's Simplifying stage packs statement-level control flow into
  // operators, and every matcher below navigates by statement boundaries.
  normalizeStatements(ast)

  // 3.2.0's calls-transform stores string-array indexes in numeric-valued storage. Resolve those
  // indexes before string-array detection/evaluation; the group below remains for older traffic
  // that is exposed only after string-array decoding.
  traverse(ast, inlineControlFlowStorage)
  const sa = decodeStringArray(ast)

  // **Refusal is narrow and means one thing: a layer that is mine, which I could not read.**
  // Returning falsy is the only signal a plugin has, so it is spent on the case where the output
  // would otherwise be silently half-decoded. The diagnostic is the point - a silent fallthrough is
  // what makes the existing entry's failures unreadable.
  if (sa.status === 'unreadable') {
    logger.error(
      '[obfuscatorx] refusing: a javascript-obfuscator string-array layer is present and could ' +
        'not be read, so decoding would emit a half-resolved program.',
    )
    for (const note of sa.notes) logger.error(`[obfuscatorx]   ${note}`)
    return null
  }

  // `absent` is not a failure - a sample built with `stringArray: false` carries every other
  // transform - and `unowned` is success plus residue, so both fall through to the rest of the
  // pipeline. Only the log distinguishes them.
  if (sa.status === 'unowned') {
    logger.log(
      '[obfuscatorx] a string-array layer is present that this entry does not own — decoding ' +
        "this entry's own layers and leaving it in place.",
    )
    for (const note of sa.notes) logger.log(`[obfuscatorx]   ${note}`)
  }

  const rounds = runGroup(ast)
  // The anti-tamper strip runs last, outside the group: its matchers need the string array decoded
  // and the control-flow storage inlined, and inside-versus-after was measured byte-identical, so
  // after wins on cost.
  unlockEnv(ast)

  logger.debugLog(`[obfuscatorx] fixpoint settled in ${rounds} round(s)`)

  // `EscapeSequenceTransformer` rewrites only a literal's `raw` spelling, so the parsed VALUE is
  // already what we want and there is no shape to match - discarding `extra` is the whole reversal,
  // exactly as it is for numbers. It runs *last*, and print-time is the honest slot: the option
  // named after it (`unicodeEscapeSequence`) does not gate the transformer at all, it only widens
  // which characters are escaped, so every sample carries this whatever it was built with, and no
  // matcher above navigates by `raw`. Scheduling it earlier would also re-spell the source that
  // `decodeStringArray` hands to its isolate, for no gain.
  traverse(ast, deleteExtra)

  // **A truthy return no longer implies fully decoded**, which is a deliberate weakening of the
  // contract taken in exchange for chainability: a foreign residual layer returns the partial
  // decode so the caller can feed it to the next target, and the log is the only place that
  // difference is visible.
  return generator(ast, { comments: false, jsescOption: { minimal: true } })
    .code
}
