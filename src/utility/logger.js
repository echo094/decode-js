/**
 * Progress logging for the decode passes, off by default.
 *
 * Every pass reports the entities it resolves - which function turned out to be the
 * string-compression helper, which name Pack unwrapped, how long a masked parameter list
 * was. That trace is worth keeping: a fail-closed pass leaves no other record of what it
 * did, so these lines are frequently the only evidence that a stage ran at all.
 *
 * It is gated because it shares **stdout** with a CLI consumer's own output and with every
 * probe that prints there - which is why probe runs have had to pipe through `grep -v`.
 *
 * Abnormal states are deliberately *not* routed through here. Those are `console.warn` on
 * stderr and stay unconditional: they report caught-exception failures that no bail-point
 * breadcrumb can observe, and at least one instrument tallies them as its entire signal, so
 * silencing them by default would remove the only visibility into that failure class.
 */
function envEnabled() {
  const v = process.env.DECODE_JS_DEBUG
  return v === '1' || v === 'true'
}

let enabled = envEnabled()

/**
 * Turn progress logging on or off programmatically. The CLI's `--verbose` flag calls this;
 * a probe can either call it or set `DECODE_JS_DEBUG=1` in the environment.
 */
function setDebugLogging(on) {
  enabled = !!on
}

function isDebugLogging() {
  return enabled
}

function debugLog(...args) {
  if (enabled) {
    console.log(...args)
  }
}

/**
 * Always-on channels, for the two things a caller cannot act on if they are hidden behind `-v`.
 *
 * `debugLog` above is per-pass tracing and is correctly off by default. A **refusal** is not
 * tracing: a plugin that returns falsy has told the caller only that it failed, so the reason has
 * to reach them or the failure is unreadable — which is exactly the weakness of a silent
 * fallthrough. A **verdict** the entry was asked to produce is likewise not tracing.
 *
 * Routed through here rather than written as bare `console.error` at each site so that the channel
 * stays one thing a caller can redirect or silence, instead of several.
 */
function log(...args) {
  console.log(...args)
}

function error(...args) {
  console.error(...args)
}

export default {
  debugLog,
  setDebugLogging,
  isDebugLogging,
  log,
  error,
}
