# Retained qualification records

A `qualification*.json` record describes its adjacent source/encoded pair: declared option vector and
seed, bounded `TEST_OUTPUT` observations, the historical decoder outcome, and an option-effect
observation. The adjacent source and encoded files are the executable evidence. For suffixed
records, the encoded filename uses the same suffix; the common source file is shared.

`provenance.generation` distinguishes recorded historical facts from unknown facts. `null` means
not retained: it must not be filled from a present checkout, filesystem timestamp, or current
generator recipe. A recorded encoder revision is a historical assertion; it does not prove
that a local build was derived from that revision. These records do not retain the generation
module bytes, dependency environment, decoder output bytes, or complete one-option-removed comparison
control sets. The seven-option macro exception cell has a retained counterpart for its anti
component; its remaining component controls are absent. `completeEffectControlsRetained: false`
describes that incomplete set, not absence of every possible counterpart. Options and seed alone cannot reproduce the exact encoded file.

Git history identifies the source/encoded bytes; the records carry no hashes of them. Executable
tests can recheck how those bytes behave and the current decoder's behavior; they cannot recover
the missing generation history. A historical
`accepted` status is a bounded cell outcome, not qualification of every program, seed or option
combination. Recorded `effectObservation` values remain historical comparisons whose complete control sets
cannot be independently rerun from this fixture population. Compound observations are true only when
all components are true, false when any is false, and otherwise null for an unavailable comparison.
This distinction does not change the separate decoder outcome.

The focused terminal-switch, protected-catch, direct-return-finally and caught-return-finally
oracles retain their declared encoder revision, seed, RNG and options separately from the
qualification records. Git history identifies the adjacent source/encoded pair. Missing date,
Node version, tool bytes and execution manifest remain null; byte identity does not authenticate
the historical generation environment.
