import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { diagnoseClassRuntime } from './analyze-class-runtime.js'
import { materializeEncodedBytecode } from './materialize-encoded-bytecode.js'
import {
  classCallLayouts,
  normalizeFakeCalls,
} from './observe-aliased-runtime.js'
import { BASE64_SHA256, runtimeSignature } from './runtime-source-signature.js'
import {
  makeContext,
  PARSER_OPTIONS,
  propertyName,
  prototypeMethods,
  topLevelDeclarations,
} from './container-role-helpers.js'

// ASTs of the pinned numeric runtime's _constant method and base64ToBytes
// helper. Lexical bindings are canonicalized before the complete-body comparison.
const CONSTANT_SHA256 =
  '16d0c5e4fa4814c756e8021b9e55b186c98bd18e95f46e14a03fa4b06c84bb67'
const signature = runtimeSignature

function classConstantSignature(
  ast,
  context,
  declarations,
  container,
  method,
  helper,
) {
  const roles = container.roles
  const layouts = classCallLayouts(context, declarations, roles, {
    operand: roles.methods.vm.operand.name,
    constant: roles.methods.vm.constant.name,
  })
  const layout = layouts.get(roles.methods.vm.constant.name)
  if (
    !layout ||
    layout.order.length !== 2 ||
    layout.fakePositions.size + 2 !== method.fn.params.length
  ) {
    throw new Error('Class constant parameters are ambiguous')
  }
  let classRuntime = diagnoseClassRuntime(ast)
  if (!classRuntime.ok) {
    classRuntime = diagnoseClassRuntime(materializeEncodedBytecode(ast))
  }
  if (!classRuntime.ok) throw new Error('Class runtime is not admitted')
  const poolField = classRuntime.result.vm.fields.pool
  const original = method.fn
  const fakeBindings = new Set(
    [...layout.fakePositions].map((index) =>
      context.bindingFor(original.params[index]),
    ),
  )
  const hasFakeReference = (node) =>
    context
      .nodes(node)
      .some(({ node: candidate }) =>
        [...fakeBindings].some((binding) =>
          context.isReference(candidate, binding),
        ),
      )
  const statements = original.body.body.filter((statement) => {
    if (!hasFakeReference(statement)) return true
    const assignment =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    if (
      assignment?.type !== 'AssignmentExpression' ||
      assignment.operator !== '=' ||
      assignment.left?.type !== 'MemberExpression' ||
      assignment.left.object?.type !== 'ThisExpression' ||
      !hasFakeReference(assignment.right)
    )
      throw new Error('Class fake parameter use changed')
    return false
  })
  const fn = t.cloneNode(original, true)
  fn.params = layout.order.map((index) => fn.params[index])
  fn.body.body = statements.map((statement) => t.cloneNode(statement, true))
  normalizeFakeCalls([t.expressionStatement(fn)], layouts)
  traverse(t.file(t.program([t.expressionStatement(fn)])), {
    noScope: true,
    MemberExpression(path) {
      if (path.node.computed || path.node.object.type !== 'ThisExpression')
        return
      const name = propertyName(path.node.property)
      if (name === roles.methods.vm.operand.name)
        path.node.property = t.identifier('_operand')
      if (name === poolField) path.node.property = t.identifier('constants')
    },
  })
  const signatureAst = t.file(
    t.program([
      t.functionDeclaration(
        t.identifier(helper.name),
        [],
        t.blockStatement([]),
      ),
      t.expressionStatement(fn),
    ]),
  )
  return signature(fn, makeContext(signatureAst))
}

export function diagnoseConcealedRuntime(source, container) {
  try {
    const ast = parse(source, PARSER_OPTIONS)
    const context = makeContext(ast)
    const declarations = topLevelDeclarations(context)
    const vm = declarations.filter(
      (item) =>
        item.kind === 'function' &&
        item.name === container.roles.constructors.VM.name,
    )
    if (vm.length !== 1) throw new Error('VM constructor is not unique')
    const methods = prototypeMethods(context, vm[0]).filter(
      (item) => item.name === container.roles.methods.vm.constant.name,
    )
    const helpers = declarations.filter(
      (item) =>
        item.kind === 'function' &&
        signature(item.init, context) === BASE64_SHA256,
    )
    if (
      helpers.length !== 1 ||
      signature(helpers[0].init, context) !== BASE64_SHA256 ||
      !helpers[0].binding?.constant
    ) {
      throw new Error('Pinned base64 helper body is absent')
    }
    const constantSignature =
      methods.length === 1
        ? container.roles.op.name === null
          ? classConstantSignature(
              ast,
              context,
              declarations,
              container,
              methods[0],
              helpers[0],
            )
          : signature(methods[0].fn, context)
        : null
    if (constantSignature !== CONSTANT_SHA256) {
      throw new Error('Pinned constant reader body is absent')
    }
    const helperCalls = context
      .nodes(methods[0].fn)
      .filter(
        ({ node }) =>
          node.type === 'CallExpression' &&
          node.callee.type === 'Identifier' &&
          context.sameRef(node.callee, helpers[0].binding),
      )
    if (
      helperCalls.length !== 1 ||
      context.bindingFor(helperCalls[0].node.callee) !== helpers[0].binding
    ) {
      throw new Error('Constant reader does not bind the pinned helper')
    }
    return {
      ok: true,
      result: { schemaVersion: 'jsconfuser-vm-concealed-runtime.v1' },
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code: 'concealed-runtime-declined',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
