import { decline, propertyName } from '../source/container-role-helpers.js'
import { isDummyLiteral } from './runtime-callables.js'

const isThis = (node) => node?.type === 'ThisExpression'

// The index of a reader's first argument a handler passes: a function reader takes the state first.
export const firstReal = (callable) => (callable.kind === 'function' ? 1 : 0)

/**
 * Calls in the runtime read against its collected callables (`callables`: each method by unique
 * name and each top-level function, with its decoy layout): what a call reaches, its arguments
 * without decoys, and whether a node is the VM state (`this`, or the run entry's state parameter,
 * `stateBinding`).
 */
export class HandlerCalls {
  constructor(context, callables, stateBinding) {
    this.context = context
    this.callables = callables
    this.stateBinding = stateBinding
  }

  isState(node) {
    return (
      isThis(node) ||
      (this.stateBinding !== null &&
        this.context.isReference(node, this.stateBinding))
    )
  }

  isField(node, field, object) {
    return (
      node?.type === 'MemberExpression' &&
      !node.computed &&
      propertyName(node.property) === field &&
      object(node.object)
    )
  }

  // A reader's receiver: `this` in a method, its first parameter in a function.
  selfOf(callable) {
    return callable.kind === 'method'
      ? isThis
      : (node) =>
          callable.fn.params[0]?.type === 'Identifier' &&
          this.context.isReference(node, callable.bindings[0])
  }

  // A reader's statements other than decoy writes.
  effectiveBody(callable) {
    return callable.fn.body.body.filter(
      (statement) =>
        !(
          statement.type === 'ExpressionStatement' &&
          callable.decoyWrites.includes(statement.expression)
        ),
    )
  }

  // The callable a call reaches: a method call on the VM (`this.m()` in a method, `vm.m()` in a
  // devirtualized function) or a call of a top-level function.
  calleeOf(node) {
    if (node?.type !== 'CallExpression') return null
    const callee = node.callee
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      this.isState(callee.object)
    ) {
      const name = propertyName(callee.property)
      return (
        this.callables.find(
          (item) => item.kind === 'method' && item.name === name,
        ) ?? null
      )
    }
    if (callee.type === 'Identifier') {
      const binding = this.context.bindingFor(callee)
      return (
        this.callables.find(
          (item) => item.kind === 'function' && item.binding === binding,
        ) ?? null
      )
    }
    return null
  }

  // A method call on any receiver (an upvalue cell's read, say), by the method's unique name.
  methodOf(node) {
    return node?.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed
      ? (this.callables.find(
          (item) =>
            item.kind === 'method' &&
            item.name === propertyName(node.callee.property),
        ) ?? null)
      : null
  }

  // A decoy argument is dead; it need only evaluate without effect: a dummy literal, or a bound
  // variable (Closure may pass one). An unbound name would throw.
  deadArgument(node) {
    return (
      isDummyLiteral(node) ||
      (node?.type === 'Identifier' && this.context.bindingFor(node) !== null)
    )
  }

  // A call's arguments with decoys removed. Minify drops trailing arguments, and a missing argument
  // is undefined, so a call may pass fewer than the callable's arity.
  realArguments(node, callable) {
    const dead = (argument) => this.deadArgument(argument)
    const extra = callable.readsArguments
      ? []
      : node.arguments.slice(callable.arity)
    if (extra.length > 0 && extra.every(dead))
      return this.realArguments(
        { ...node, arguments: node.arguments.slice(0, callable.arity) },
        callable,
      )
    if (callable.decoys.size === 0 || node.arguments.length === 0)
      return node.arguments
    if (
      node.arguments.length > callable.arity ||
      [...callable.decoys].some(
        (index) =>
          index < node.arguments.length && !dead(node.arguments[index]),
      )
    )
      decline('handler-locator', 'Class decoy call arguments changed')
    return node.arguments.filter((_, index) => !callable.decoys.has(index))
  }
}
