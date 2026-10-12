import { parse } from '@babel/parser'
import { diagnoseClassRuntime } from './analyze-class-runtime.js'
import { classRuntimeContainer } from './class-runtime-container.js'
import { materializeHandlerTable } from './materialize-handler-table.js'
import { materializeEncodedBytecode } from './materialize-encoded-bytecode.js'
import { materializeMinifiedEncodedBytecode } from './materialize-minified-encoded-bytecode.js'
import { materializeRandomizedMinifiedClass } from './materialize-randomized-minified-class.js'
import { materializeRandomizedRuntime } from './materialize-randomized-runtime.js'
import {
  diagnoseMinifiedHandlerTable,
  diagnoseMinifiedRuntime,
} from './observe-minified-runtime.js'
import { minifiedRuntimeContainer } from './minified-runtime-container.js'
import { diagnoseMinifiedClassRuntime } from './observe-minified-class-runtime.js'
import { minifiedClassRuntimeContainer } from './minified-class-runtime-container.js'
import {
  ContainerDecline,
  EXPECTED_OPCODES,
  EXPECTED_SENTINELS,
  EXPECTED_SLOTS,
  PARSER_OPTIONS,
  closureShape,
  decline,
  deepFreeze,
  exactNumericObject,
  functionDeclarations,
  isPoolArray,
  isWordArray,
  makeContext,
  methodCall,
  newCall,
  parameterBinding,
  propertyName,
  prototypeMethods,
  referenceCount,
  referencePaths,
  scalarValue,
  topLevelDeclarations,
  topLevelVariables,
  uniqueCandidate,
  upvalueMethodRoles,
  upvalueShape,
  vmShape,
} from './container-role-helpers.js'
import {
  bootGraph,
  identifyScalars,
  identifyVmMethodRoles,
} from './container-runtime-roles.js'

function assertMapReferences(context, runtime, roles) {
  const opUses = referencePaths(context, roles.op.binding)
  const opUseNames = new Set(
    opUses
      .map((path) => path.parentPath?.node)
      .filter((node) => node?.type === 'MemberExpression' && !node.computed)
      .map((node) => propertyName(node.property)),
  )
  if (
    Object.keys(EXPECTED_OPCODES).some((name) => !opUseNames.has(name)) ||
    opUses.some(
      (path) =>
        path.parentPath?.node?.type !== 'MemberExpression' ||
        path.parentPath.node.computed ||
        !Object.prototype.hasOwnProperty.call(
          EXPECTED_OPCODES,
          propertyName(path.parentPath.node.property),
        ),
    ) ||
    opUses.some(
      (path) =>
        !path.findParent(
          (parent) => parent.node === runtime.vmMethods.run[0].fn,
        ),
    )
  ) {
    decline(
      'incomplete-role',
      'OP map is not connected to the complete dispatch',
    )
  }

  const sentinelUses = referencePaths(context, roles.sentinels.binding)
  const dispatch = context
    .nodes(runtime.vmMethods.run[0].fn)
    .find(({ node }) => node.type === 'SwitchStatement')?.node
  const callCases = ['CALL', 'CALL_METHOD', 'NEW'].map((name) =>
    dispatch?.cases.find(
      (entry) =>
        entry.test?.type === 'MemberExpression' &&
        !entry.test.computed &&
        context.sameRef(entry.test.object, roles.op.binding) &&
        propertyName(entry.test.property) === name,
    ),
  )
  if (
    sentinelUses.length < 3 ||
    sentinelUses.some(
      (path) =>
        path.parentPath?.node?.type !== 'MemberExpression' ||
        propertyName(path.parentPath.node.property) !== 'CALL_SPREAD' ||
        !path.findParent(
          (parent) => parent.node === runtime.vmMethods.run[0].fn,
        ),
    ) ||
    callCases.some(
      (entry) =>
        !entry ||
        sentinelUses.filter((path) =>
          path.findParent((parent) => parent.node === entry),
        ).length !== 1,
    )
  ) {
    decline('incomplete-role', 'CALL_SPREAD is not connected to all call paths')
  }

  const slotUses = referencePaths(context, roles.slots.binding)
  const slotNames = new Set(
    slotUses
      .map((path) => path.parentPath?.node)
      .filter((node) => node?.type === 'MemberExpression' && !node.computed)
      .map((node) => propertyName(node.property)),
  )
  if (Object.keys(EXPECTED_SLOTS).some((name) => !slotNames.has(name))) {
    decline('incomplete-role', 'Frame slot map is not structurally connected')
  }

  if (
    referenceCount(context, roles.pool.binding) !== 1 ||
    referenceCount(context, roles.words.binding) !== 1
  ) {
    decline(
      'ambiguous-role',
      'Pool or wordcode binding has unexpected references',
    )
  }
}

function assertRuntimeGraph(context, roles, scalarRoles, boot) {
  const methods = roles.vmMethods
  const run = methods.run[0].fn
  const requiredCalls = [
    ['operand', methods.operand[0].name],
    ['constant', methods.constant[0].name],
    ['captureUpvalue', methods.captureUpvalue[0].name],
    ['closeUpvalues', methods.closeUpvalues[0].name],
  ]
  for (const [role, name] of requiredCalls) {
    if (
      !methodCall(
        context,
        run,
        (value) => value?.type === 'ThisExpression',
        name,
      )
    ) {
      decline('incomplete-role', `VM.run does not use ${role}`)
    }
  }
  if (
    !methodCall(
      context,
      run,
      (value) => value?.type === 'ThisExpression',
      methods.pushFrame[0].name,
      parameterBinding(context, run, 0),
    ) ||
    !methodCall(context, run, () => true, roles.upvalueMethods.read[0].name) ||
    !methodCall(context, run, () => true, roles.upvalueMethods.write[0].name) ||
    !newCall(context, run, roles.vm.binding) ||
    !newCall(context, run, roles.closure.binding)
  ) {
    decline(
      'incomplete-role',
      'VM/Closure execution relationship is incomplete',
    )
  }

  if (
    !methodCall(
      context,
      methods.closeUpvalues[0].fn,
      () => true,
      roles.upvalueMethods.close[0].name,
    ) ||
    !newCall(context, methods.captureUpvalue[0].fn, roles.upvalue.binding)
  ) {
    decline('incomplete-role', 'Upvalue lifetime relationship is incomplete')
  }

  const runProperty = methods.run[0].name
  if (propertyName(boot.rootCall.callee.property) !== runProperty) {
    decline('altered-boot', 'Root boot call is not bound to VM.run')
  }
  if (
    scalarRoles.encode.binding !==
      context.bindingFor(
        boot.decoder.init.body.body.find((node) => node.type === 'IfStatement')
          ?.test?.argument,
      ) ||
    scalarRoles.frameStart.binding !== roles.vmShape.frameStartBinding ||
    scalarRoles.header.binding !== roles.headerBinding
  ) {
    decline(
      'incomplete-role',
      'Scalar roles are not connected to runtime metadata',
    )
  }
}

function valuesForPool(node) {
  return node.elements.map((element) => {
    if (element.type === 'UnaryExpression' && element.operator === '-') {
      return -element.argument.value
    }
    if (
      element.type === 'StringLiteral' ||
      element.type === 'NumericLiteral' ||
      element.type === 'BooleanLiteral'
    ) {
      return element.value
    }
    if (element.type === 'NullLiteral') return null
    return undefined
  })
}

function makeResult(roles, scalarRoles, boot) {
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-container.v1',
    encoding: 'numeric-u32',
    roles: {
      pool: { name: roles.pool.name, values: valuesForPool(roles.pool.init) },
      words: {
        name: roles.words.name,
        values: roles.words.init.elements.map((element) => element.value),
      },
      op: { name: roles.op.name, values: { ...EXPECTED_OPCODES } },
      sentinels: {
        name: roles.sentinels.name,
        values: { ...EXPECTED_SENTINELS },
      },
      slots: { name: roles.slots.name, values: { ...EXPECTED_SLOTS } },
      scalars: Object.fromEntries(
        Object.entries({
          MAIN_START_PC: boot.start,
          MAIN_REG_COUNT: boot.regCount,
          ENCODE_BYTECODE: scalarRoles.encode,
          TIMING_CHECKS: scalarRoles.timing,
          HEADER_SIZE: scalarRoles.header,
          FRAME_START: scalarRoles.frameStart,
        }).map(([role, declaration]) => [
          role,
          { name: declaration.name, value: scalarValue(declaration.init) },
        ]),
      ),
      constructors: {
        Upvalue: { name: roles.upvalue.name },
        Closure: { name: roles.closure.name },
        VM: { name: roles.vm.name },
      },
      methods: {
        upvalue: Object.fromEntries(
          Object.entries(roles.upvalueMethods).map(([role, list]) => [
            role,
            { name: list[0].name },
          ]),
        ),
        vm: Object.fromEntries(
          Object.entries(roles.vmMethods).map(([role, list]) => [
            role,
            { name: list[0].name },
          ]),
        ),
      },
      roots: {
        globals: { name: boot.globals.name },
        vm: { name: boot.vm.name },
        decoder: { name: boot.decoder.name },
        bootMethod: { name: propertyName(boot.rootCall.callee.property) },
      },
    },
  })
}

function recognize(ast) {
  const context = makeContext(ast)
  const declarations = topLevelDeclarations(context)
  const variables = topLevelVariables(declarations)

  const pool = uniqueCandidate(
    variables.filter((candidate) => isPoolArray(candidate.init, context)),
    'constant pool array',
  )
  const words = uniqueCandidate(
    variables.filter((candidate) => isWordArray(candidate.init)),
    'numeric word array',
  )
  const op = uniqueCandidate(
    variables.filter((candidate) =>
      exactNumericObject(candidate.init, EXPECTED_OPCODES),
    ),
    'canonical opcode map',
  )
  const sentinels = uniqueCandidate(
    variables.filter((candidate) =>
      exactNumericObject(candidate.init, EXPECTED_SENTINELS),
    ),
    'sentinel map',
  )
  const slots = uniqueCandidate(
    variables.filter((candidate) =>
      exactNumericObject(candidate.init, EXPECTED_SLOTS),
    ),
    'frame slot map',
  )

  const functions = functionDeclarations(declarations)
  const upvalue = uniqueCandidate(
    functions
      .map((fn) => declarations.find((declaration) => declaration.init === fn))
      .filter((declaration) => upvalueShape(declaration.init, context)),
    'Upvalue constructor',
  )
  const closure = uniqueCandidate(
    functions
      .map((fn) => declarations.find((declaration) => declaration.init === fn))
      .filter((declaration) => closureShape(declaration.init, context)),
    'Closure constructor',
  )
  const vmCandidates = functions
    .map((fn) => declarations.find((declaration) => declaration.init === fn))
    .map((declaration) => ({
      declaration,
      shape: vmShape(declaration.init, context),
    }))
    .filter(({ shape }) => !!shape)
  const vm = uniqueCandidate(
    vmCandidates.map(({ declaration }) => declaration),
    'VM constructor',
  )
  const vmShapeResult = vmCandidates.find(
    ({ declaration }) => declaration === vm,
  ).shape

  const upvalueMethods = prototypeMethods(context, upvalue)
  const upvalueMethodRolesResult = upvalueMethodRoles(upvalueMethods, context)
  if (
    upvalueMethods.length !== 3 ||
    Object.values(upvalueMethodRolesResult).some((list) => list.length !== 1)
  ) {
    decline('incomplete-role', 'Upvalue methods are not complete and unique')
  }

  const headerCandidates = variables.filter(
    (candidate) => scalarValue(candidate.init) === 8,
  )
  const vmMethods = prototypeMethods(context, vm)
  const vmMethodRoles = identifyVmMethodRoles(vmMethods, context, {
    op,
    slots,
    upvalue,
    upvalueClose: upvalueMethodRolesResult.close,
    vmShape: vmShapeResult,
    headerCandidates,
  })
  if (
    vmMethods.length !== 6 ||
    Object.values(vmMethodRoles).some((list) => list.length !== 1)
  ) {
    decline(
      'incomplete-role',
      `VM methods are not complete and unique (${Object.entries(vmMethodRoles)
        .map(([role, list]) => `${role}=${list.length}`)
        .join(', ')})`,
    )
  }
  const frameStartBinding = context.bindingFor(vmShapeResult.frameStart)
  if (!frameStartBinding) decline('missing-role', 'Missing FRAME_START binding')

  const structuralRoles = {
    closure,
    op,
    pool,
    sentinels,
    slots,
    upvalue,
    vm,
    vmShape: { ...vmShapeResult, frameStartBinding },
    vmMethods: vmMethodRoles,
    upvalueMethods: upvalueMethodRolesResult,
    words,
  }
  const boot = bootGraph(context, declarations, structuralRoles)
  const scalarRoles = identifyScalars(
    context,
    declarations,
    structuralRoles,
    boot,
  )
  assertMapReferences(context, structuralRoles, structuralRoles)
  assertRuntimeGraph(context, structuralRoles, scalarRoles, boot)
  return makeResult(
    {
      ...structuralRoles,
      headerBinding: scalarRoles.header.binding,
    },
    scalarRoles,
    boot,
  )
}

function parseInput(input) {
  if (typeof input === 'string') return parse(input, PARSER_OPTIONS)
  if (input?.type === 'File' || input?.type === 'Program') return input
  decline(
    'invalid-input',
    'Container extractor expects source text or a Babel AST',
  )
}

export function diagnoseContainer(input) {
  try {
    const ast = parseInput(input)
    let result
    try {
      result = recognize(ast)
    } catch (error) {
      if (!(error instanceof ContainerDecline)) throw error
      let decodedPayload
      try {
        decodedPayload = materializeEncodedBytecode(ast)
      } catch (encodingError) {
        if (!(encodingError instanceof ContainerDecline)) throw encodingError
      }
      if (decodedPayload) return diagnoseContainer(decodedPayload)
      let minifiedPayload
      try {
        minifiedPayload = materializeMinifiedEncodedBytecode(ast)
      } catch (encodingError) {
        if (!(encodingError instanceof ContainerDecline)) throw encodingError
      }
      if (minifiedPayload) return diagnoseContainer(minifiedPayload)
      let canonicalRuntime
      try {
        canonicalRuntime = materializeRandomizedRuntime(ast)
      } catch (randomizationError) {
        if (!(randomizationError instanceof ContainerDecline))
          throw randomizationError
      }
      if (canonicalRuntime) return diagnoseContainer(canonicalRuntime)
      let classRuntime = diagnoseClassRuntime(ast)
      if (!classRuntime.ok) {
        const randomizedClass = diagnoseClassRuntime(ast, { randomized: true })
        if (randomizedClass.ok) classRuntime = randomizedClass
        else if (
          randomizedClass.diagnostic.code.startsWith('randomized-class-')
        )
          decline(
            randomizedClass.diagnostic.code,
            randomizedClass.diagnostic.message,
          )
      }
      if (classRuntime.ok) {
        result = classRuntimeContainer(classRuntime.result)
      } else {
        // The complete ordinary minified contract owns explicit-map runtime
        // spelling. Provisional class layout inference can also find its header
        // roles, so let this enclosing proof establish the family first.
        const minifiedRuntime = diagnoseMinifiedRuntime(ast)
        if (minifiedRuntime.ok)
          return deepFreeze({
            ok: true,
            result: minifiedRuntimeContainer(minifiedRuntime.result),
            diagnostic: null,
          })
        const minifiedClass = diagnoseMinifiedClassRuntime(ast)
        if (minifiedClass.ok) {
          return deepFreeze({
            ok: true,
            result: minifiedClassRuntimeContainer(minifiedClass.result),
            diagnostic: null,
          })
        }
        // These complete-phase diagnostics follow a connected boot. Preserve
        // the recognized source refusal instead of trying a weaker fallback.
        if (minifiedClass.diagnostic.code.startsWith('minified-class-'))
          decline(
            minifiedClass.diagnostic.code,
            minifiedClass.diagnostic.message,
          )
        const randomizedMinifiedClass = materializeRandomizedMinifiedClass(ast)
        if (randomizedMinifiedClass) {
          const complete = diagnoseMinifiedClassRuntime(
            randomizedMinifiedClass.ast,
          )
          if (!complete.ok)
            decline(complete.diagnostic.code, complete.diagnostic.message)
          return deepFreeze({
            ok: true,
            result: minifiedClassRuntimeContainer(complete.result),
            diagnostic: null,
          })
        }
        const minifiedTable = diagnoseMinifiedHandlerTable(ast)
        if (minifiedTable.ok) {
          result = minifiedRuntimeContainer(minifiedTable.result)
        } else {
          let normalized
          try {
            normalized = materializeHandlerTable(ast)
          } catch (handlerError) {
            if (handlerError instanceof ContainerDecline) throw error
            throw handlerError
          }
          const materializedClass = diagnoseClassRuntime(normalized)
          result = materializedClass.ok
            ? classRuntimeContainer(materializedClass.result)
            : recognize(normalized)
        }
      }
    }
    return deepFreeze({ ok: true, result, diagnostic: null })
  } catch (error) {
    if (error instanceof ContainerDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'extractor-error',
        message: error.message,
      },
    })
  }
}

export function extractContainer(input) {
  return diagnoseContainer(input).result
}

export function extractContainerFromSource(source) {
  return extractContainer(source)
}

export default extractContainer
