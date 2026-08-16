import * as t from '@babel/types'

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Drop the brackets from a member read whose key is a plain string:
 *
 *   o["foo"]   =>   o.foo
 *
 * Obfuscators rewrite every static property name into a computed string so that a string-
 * concealing pass can reach it; once the string is back, the brackets carry no information.
 * Restoring the dotted form is what lets later matchers key on `o.foo` at all, and it is the
 * single most common residue shape in this kind of output.
 *
 * **The identifier gate is the safety argument, and it is not cosmetic.** `o["foo bar"]` and
 * `o["0"]` have no dotted spelling, so they are declined and left computed. A pass that
 * rewrote them anyway would emit code that does not parse. The gate doubles as a correctness
 * check on the layer beneath: a decoded string sitting in a member key that is *not* a valid
 * identifier is evidence that the string was decoded wrongly, because the encoder put a real
 * property name there.
 *
 * **No key needs excluding here, unlike a property *key*.** `o["__proto__"]` and `o.__proto__`
 * are the same accessor, and there is no member-read analogue of the object-literal `__proto__`
 * special case or of `class C { ["constructor"](){} }`. Those hazards live in
 * `uncompute-property-key.js`, which is why the two are separate files rather than one.
 *
 * Optional members (`o?.["foo"]`) are the same rewrite and are handled alongside.
 */
export function createUncomputeMember(onChange) {
  const visit = (path) => {
    const { node } = path
    if (!node.computed || !t.isStringLiteral(node.property)) {
      return
    }
    if (!IDENTIFIER.test(node.property.value)) {
      return
    }
    node.property = t.identifier(node.property.value)
    node.computed = false
    if (onChange) {
      onChange()
    }
  }
  return {
    MemberExpression: visit,
    OptionalMemberExpression: visit,
  }
}

export default createUncomputeMember()
