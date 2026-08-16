import * as t from '@babel/types'

/**
 * Collapse a property whose key and value are the same name back to shorthand:
 *
 *   const { foo: foo } = bar;   =>   const { foo } = bar;
 *   ({ foo: foo })              =>   ({ foo })
 *
 * Obfuscators expand shorthand so that a renaming pass has two nodes where the source had one -
 * in `{ foo }` the single token is both the property read and the binding declared, and a
 * renamer must rewrite the binding while leaving the property name alone. Once renaming has
 * happened the expanded form carries no information; it is just longer.
 *
 * **One exclusion, and it is the reverse of the usual `__proto__` trap.** In an
 * *ObjectExpression*, `{ __proto__: x }` sets the prototype while the shorthand `{ __proto__ }`
 * merely defines an own property - so collapsing it changes meaning. The special case is scoped
 * to the `PropertyName : AssignmentExpression` form, which is exactly what collapsing removes.
 * Verified by construction rather than from the spec: `Object.getPrototypeOf` reports the
 * prototype set for the expanded form and not for the shorthand.
 *
 * In an *ObjectPattern* there is no such hazard - destructuring `{ __proto__: __proto__ }` and
 * `{ __proto__ }` both bind the name - but the gate does not need to distinguish them, because
 * refusing the name in both positions costs one unreachable collapse and removes a class of
 * error entirely.
 *
 * **`export { foo as foo }` is deliberately not handled here.** It parses to the *same* AST as
 * `export { foo }` - Babel represents both as an `ExportSpecifier` whose `local` and `exported`
 * names match - so there is no node to rewrite, and the generator already prints the short form.
 * That reversal is free at generation time and needs no pass.
 */
export function createCollapsePropertyShorthand(onChange) {
  return {
    ObjectProperty(path) {
      const { node } = path
      if (node.computed || node.shorthand) {
        return
      }
      if (!t.isIdentifier(node.key) || !t.isIdentifier(node.value)) {
        return
      }
      if (node.key.name !== node.value.name) {
        return
      }
      if (node.key.name === '__proto__') {
        return
      }
      node.shorthand = true
      if (onChange) {
        onChange()
      }
    },
  }
}

export default createCollapsePropertyShorthand()
