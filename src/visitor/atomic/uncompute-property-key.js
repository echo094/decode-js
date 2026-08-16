import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Restore a property or class-member key that was rewritten into a string:
 *
 *   ["foo"]() {}   =>   "foo"() {}   =>   foo() {}
 *   { "foo": 1 }                     =>   { foo: 1 }
 *
 * **This is two rewrites, not one, and only the first is dangerous.** Un-computing changes
 * meaning for three keys; de-literalizing an already-non-computed key changes meaning for none.
 * Keeping them as separate steps is what lets the risky half delegate to a guard that already
 * exists and the safe half stay a plain rewrite.
 *
 * **Step 1 - un-compute, via `safeFunc.uncomputeStringKey`.** That helper is shared and already
 * refuses the three keys whose meaning changes: `{ ["__proto__"]: v }` defines an own property
 * where `{ "__proto__": v }` sets the prototype; `class C { ["constructor"](){} }` is an
 * ordinary method where `"constructor"(){}` *is* the class constructor; and
 * `static ["prototype"]` is a runtime error un-computed. This pass calls it rather than
 * reimplementing the list, so there is one place to correct if a fourth case turns up.
 *
 * **Step 2 - de-literalize, gated on the identifier form.** Once a key is non-computed the
 * remaining change is spelling only: `{ "__proto__": v }` and `{ __proto__: v }` are both the
 * prototype setter, and `"constructor"(){}` and `constructor(){}` are both the constructor. So
 * no exclusion list applies here, and the only gate is whether the string has an identifier
 * spelling at all - `{ "foo bar": 1 }` and `{ "0": 1 }` are declined and stay quoted.
 *
 * A key that was *already* non-computed skips step 1 and is still eligible for step 2, which is
 * what makes the pass idempotent and safe to re-run in a fixpoint loop.
 */
export function createUncomputePropertyKey(onChange) {
  const visit = (path) => {
    const { node } = path
    if (!t.isStringLiteral(node.key)) {
      return
    }
    let changed = false

    // Step 1: the guarded half. `uncomputeStringKey` takes the KEY path and decides for itself
    // whether this owner and name may lose the brackets.
    if (node.computed) {
      safeFunc.uncomputeStringKey(path.get('key'))
      if (!node.computed) {
        changed = true
      }
    }

    // Step 2: pure spelling, and only once the key is non-computed.
    if (!node.computed && IDENTIFIER.test(node.key.value)) {
      node.key = t.identifier(node.key.value)
      changed = true
    }

    if (changed && onChange) {
      onChange()
    }
  }
  return {
    ObjectProperty: visit,
    ObjectMethod: visit,
    ClassMethod: visit,
    ClassProperty: visit,
  }
}

export default createUncomputePropertyKey()
