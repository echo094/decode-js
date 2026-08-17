import logger from '../../utility/logger.js'

/**
 * Turn a detector signature into an era vector and a version range.
 *
 * Emitted output cannot identify an exact version, only an **era** - a maximal version range over
 * which some named thing about the encoder holds still. So this reports a range, derived as the
 * *intersection* of the per-component verdicts, and never a single version.
 *
 * **It never gates a decode.** An unrecognised signature yields `unknown` for that component and a
 * decode that has already resolved its entrypoint proceeds regardless; refusal is reserved for a
 * layer that is ours and unreadable, which is a different question this file does not answer.
 *
 * **Per-component, because a verdict has to be able to be partial.** A sample built with rotation
 * disabled carries no evidence on that axis at any version, so naming an era for it would be
 * inventing one. Only the axes that carry evidence take part in the intersection.
 */

/**
 * Era ranges, transcribed from the encoder package's era registry, which is the only place a range
 * and the commit that verified it appear together. Bounds are inclusive.
 *
 * Kept as data rather than as branches so a registry gaining a row is one edit here and none in the
 * matcher - detection is shape-first, so the era is an output of matching rather than an input to
 * it, and nothing downstream keys on these names.
 */
const ERA_RANGES = {
  'E-sa-array-declaration': ['0.25.0', '2.18.1'],
  'E-sa-array-self-replacing-fn': ['2.19.0', '5.5.0'],
  'E-sa-wrapper-var-fn-expression': ['2.9.0', '2.11.1'],
  'E-sa-wrapper-fn-declaration': ['2.12.0', '2.15.3'],
  'E-sa-wrapper-self-replacing': ['2.15.4', '2.18.1'],
  'E-sa-wrapper-array-fn-call': ['2.19.0', '4.1.1'],
  'E-sa-wrapper-flat': ['4.2.0', '5.5.0'],
  'E-sa-rotate-counter-loop': ['0.28.0', '2.9.6'],
  'E-sa-rotate-compare-loop': ['2.10.0', '2.18.1'],
  'E-sa-rotate-compare-loop-fn-arg': ['2.19.0', '5.5.0'],
}

/** Signature string -> era ID, per component. */
const SIGNATURE_ERAS = {
  holder: {
    'var-declaration': 'E-sa-array-declaration',
    'fn-self-replacing': 'E-sa-array-self-replacing-fn',
  },
  wrapper: {
    'var-function-expression/plain/reads-identifier':
      'E-sa-wrapper-var-fn-expression',
    'function-declaration/plain/reads-identifier':
      'E-sa-wrapper-fn-declaration',
    'function-declaration/self-replacing/reads-identifier':
      'E-sa-wrapper-self-replacing',
    'function-declaration/self-replacing/reads-call-hoisted':
      'E-sa-wrapper-array-fn-call',
    'function-declaration/plain/reads-call-hoisted': 'E-sa-wrapper-flat',
  },
  rotate: {
    'counter-loop/none': 'E-sa-rotate-counter-loop',
    'compare-loop/parseint-mul': 'E-sa-rotate-compare-loop',
    'compare-loop/parseint-div': 'E-sa-rotate-compare-loop-fn-arg',
  },
}

/**
 * The remaining unverified interval between the contiguous walk through 4.2.0 and the separately
 * pinned 5.5.0. A range landing inside the hole is reported as unverified rather than interpolated
 * across releases that have not been built and run.
 */
const COVERAGE_HOLE = ['4.2.1', '5.4.7']

const parts = (v) => v.split('.').map(Number)
function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  }
  return 0
}
const maxV = (a, b) => (compareVersions(a, b) >= 0 ? a : b)
const minV = (a, b) => (compareVersions(a, b) <= 0 ? a : b)

/**
 * @param {{holder: string, wrapper: string, rotate: string}} signature
 * @returns {{
 *   eras: Record<string, string|null>,
 *   range: {low: string, high: string}|null,
 *   conflict: boolean,
 *   inCoverageHole: boolean,
 * }}
 */
export function deriveEra(signature) {
  const eras = {}
  for (const component of ['holder', 'wrapper', 'rotate']) {
    const value = signature?.[component]
    if (value === undefined || value === 'none') {
      // `rotate=none` is the case this exists for: rotation is an option, so its absence is
      // evidence about the options and says nothing about the version. Not unknown - *absent*.
      eras[component] = null
      continue
    }
    eras[component] = SIGNATURE_ERAS[component][value] ?? 'unknown'
  }

  const known = Object.values(eras).filter((e) => e && e !== 'unknown')
  if (!known.length) {
    return { eras, range: null, conflict: false, inCoverageHole: false }
  }

  let low = '0.0.0'
  let high = '99.99.99'
  for (const era of known) {
    const [lo, hi] = ERA_RANGES[era]
    low = maxV(low, lo)
    high = minV(high, hi)
  }
  const conflict = compareVersions(low, high) > 0
  const inCoverageHole =
    !conflict &&
    compareVersions(low, COVERAGE_HOLE[1]) <= 0 &&
    compareVersions(high, COVERAGE_HOLE[0]) >= 0
  return {
    eras,
    range: conflict ? null : { low, high },
    conflict,
    inCoverageHole,
  }
}

/**
 * Log the verdict. Reporting only - it returns nothing a caller can gate on, by design.
 *
 * **An empty intersection is a diagnostic, not a failure.** It means the components disagree about
 * which version could have emitted them, so the sample is either not stock - a modified variant, a
 * hand-edited file, a second encoder over the top - or from a version whose shape nobody has
 * recorded. Either way the decode has already happened by the time this runs.
 */
export function reportEra(signature) {
  const verdict = deriveEra(signature)
  const vector = Object.entries(verdict.eras)
    .map(([k, v]) => `${k}=${v ?? 'no-evidence'}`)
    .join(' ')

  if (verdict.conflict) {
    logger.error(
      `[obfuscatorx] era: ${vector} — components disagree, so no version could have emitted ` +
        `all of them. Not stock: a modified variant, or a version whose shape is unrecorded. ` +
        `The decode above is unaffected.`,
    )
    return verdict
  }
  if (!verdict.range) {
    logger.log(
      `[obfuscatorx] era: ${vector} — no component carries version evidence, so the version is ` +
        `unknown. This is the expected reading for a sample with no string array.`,
    )
    return verdict
  }
  logger.log(
    `[obfuscatorx] era: ${vector} — version in [${verdict.range.low}, ${verdict.range.high}]` +
      (verdict.inCoverageHole
        ? ', which overlaps the 3.0.0–4.2.2 range this entry has never verified; treat as unknown ' +
          'rather than covered'
        : ''),
  )
  return verdict
}

export default reportEra
