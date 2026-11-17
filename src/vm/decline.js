// The VM decoder's one refusal protocol, shared by the frontend and the switch backend.
//
// A component refuses its input by throwing a Decline tagged with its owner. Its boundary turns a
// run into a record `{ ok, result, diagnostic }` (`accepted`, `refused`): a Decline of its own owners becomes the
// diagnostic, any other Decline or exception becomes the component's fallback code when it has
// one, and otherwise passes to the caller. `unwrap` reads another component's record back into
// this owner's Decline, so a refusal keeps its code and message as it crosses components.

class Decline extends Error {
  constructor(owner, code, message, details = {}) {
    super(message)
    this.name = 'Decline'
    this.owner = owner
    this.code = code
    this.details = details
  }
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The refusal helpers of one owner. `details` are the extra diagnostic fields every refusal of
 * this owner carries, with their defaults.
 */
export function declines(owner, details = {}) {
  const decline = (code, message, extra = {}) => {
    throw new Decline(owner, code, message, { ...details, ...extra })
  }
  const requireValue = (value, code, message) => {
    if (!value) decline(code, message)
    return value
  }
  const unwrap = (diagnosis, extra) => {
    if (!diagnosis.ok)
      decline(diagnosis.diagnostic.code, diagnosis.diagnostic.message, extra)
    return diagnosis.result
  }
  // A run's record: `accepted(result)` when it completes, `refused(error)` when it throws. Each
  // boundary installs its own handler: `try { return accepted(run) } catch (e) { return refused(e) }`.
  // `fallback`: the code an exception that is not this owner's refusal becomes; without one it is
  // rethrown. `owners`: the owners whose refusals are this component's (default: this owner).
  // `freeze`: deep-freeze the record.
  const accepted = (result, { freeze = false } = {}) => {
    const record = { ok: true, result, diagnostic: null }
    return freeze ? deepFreeze(record) : record
  }
  const refused = (
    error,
    { fallback = null, owners = [owner], freeze = false } = {},
  ) => {
    let record
    if (error instanceof Decline && owners.includes(error.owner)) {
      record = {
        ok: false,
        result: null,
        diagnostic: {
          code: error.code,
          message: error.message,
          ...error.details,
        },
      }
    } else if (fallback) {
      record = {
        ok: false,
        result: null,
        diagnostic: {
          code: fallback,
          message: errorMessage(error),
          ...details,
        },
      }
    } else throw error
    return freeze ? deepFreeze(record) : record
  }
  return { decline, requireValue, unwrap, accepted, refused }
}
