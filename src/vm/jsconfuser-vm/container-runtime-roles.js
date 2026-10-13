import {
  EXPECTED_SLOTS,
  binaryParts,
  computedMember,
  decline,
  findVariable,
  hasNode,
  isIdentifier,
  isStableDeclaration,
  member,
  methodCall,
  newCall,
  numberValue,
  parameterBinding,
  readPlainObject,
  referenceCount,
  scalarValue,
  slotMember,
  thisMember,
  topLevelVariables,
  uniqueCandidate,
} from './container-role-helpers.js'

export function identifyVmMethodRoles(methods, context, roles) {
  const { op, slots, upvalue, upvalueClose } = roles
  const operand = methods.filter(({ fn }) => {
    if (fn.params.length !== 0 || fn.body?.body.length !== 1) return false
    const statement = fn.body.body[0]
    const outer =
      statement.type === 'ReturnStatement' ? statement.argument : null
    if (
      !computedMember(
        outer,
        (value) => thisMember(value, 'bytecode'),
        (value) =>
          value?.type === 'UpdateExpression' &&
          value.operator === '++' &&
          value.prefix === false,
      )
    ) {
      return false
    }
    const pc = outer.property.argument
    return computedMember(
      pc,
      (value) => thisMember(value, '_regs'),
      (value) =>
        value?.type === 'BinaryExpression' &&
        value.operator === '+' &&
        thisMember(value.left, '_f') &&
        slotMember(value.right, slots.binding, 'PC', context),
    )
  })

  const pushFrame = methods.filter(({ fn }) => {
    if (fn.params.length !== 4) return false
    const fnLocal = findVariable(context, fn, (init) =>
      member(
        init,
        (value) => context.sameRef(value, parameterBinding(context, fn, 0)),
        'fn',
      ),
    )
    const regsLocal = findVariable(context, fn, (init) =>
      thisMember(init, '_regs'),
    )
    const fpLocal = findVariable(context, fn, (init) =>
      thisMember(init, '_regsTop'),
    )
    if (!fnLocal || !regsLocal || !fpLocal) return false
    const headers = roles.headerCandidates
    const sizeLocal = findVariable(context, fn, (init) => {
      const parts = binaryParts(init)
      return (
        !!parts &&
        parts.some((part) =>
          member(
            part,
            (value) => context.sameRef(value, context.bindingFor(fnLocal.id)),
            'regCount',
          ),
        ) &&
        parts.some((part) =>
          headers.some((header) => context.sameRef(part, header.binding)),
        )
      )
    })
    const baseLocal = findVariable(context, fn, (init) => {
      const parts = binaryParts(init)
      return (
        !!parts &&
        parts.some((part) =>
          context.sameRef(part, context.bindingFor(fpLocal.id)),
        ) &&
        parts.some((part) =>
          headers.some((header) => context.sameRef(part, header.binding)),
        )
      )
    })
    const endLocal = findVariable(context, fn, (init) => {
      const parts = binaryParts(init)
      return (
        !!parts &&
        parts.some((part) =>
          context.sameRef(part, context.bindingFor(fpLocal.id)),
        ) &&
        parts.some((part) =>
          context.sameRef(part, context.bindingFor(sizeLocal?.id)),
        )
      )
    })
    if (!sizeLocal || !baseLocal || !endLocal) return false
    return (
      hasNode(
        context,
        fn,
        (node) =>
          node.type === 'AssignmentExpression' &&
          thisMember(node.left, '_regsTop') &&
          context.sameRef(node.right, context.bindingFor(endLocal.id)),
      ) &&
      hasNode(
        context,
        fn,
        (node) =>
          node.type === 'AssignmentExpression' &&
          thisMember(node.left, '_f') &&
          context.sameRef(node.right, context.bindingFor(fpLocal.id)),
      ) &&
      Object.keys(EXPECTED_SLOTS)
        .filter((role) => role !== 'HANDLERS')
        .every((role) =>
          hasNode(context, fn, (node) =>
            slotMember(node, slots.binding, role, context),
          ),
        )
    )
  })

  const captureUpvalue = methods.filter(
    ({ fn }) =>
      fn.params.length === 2 &&
      newCall(context, fn, upvalue.binding) &&
      hasNode(context, fn, (node) => thisMember(node, '_openUpvalues')) &&
      hasNode(context, fn, (node) => thisMember(node, '_regs')) &&
      hasNode(context, fn, (node) =>
        slotMember(node, slots.binding, 'REG_BASE', context),
      ) &&
      hasNode(context, fn, (node) => node.type === 'ReturnStatement'),
  )

  const constant = methods.filter(
    ({ fn }) =>
      fn.params.length === 2 &&
      hasNode(context, fn, (node) => thisMember(node, 'constants')) &&
      methodCall(
        context,
        fn,
        (value) => value?.type === 'ThisExpression',
        operand[0]?.name,
      ) &&
      hasNode(context, fn, (node) => node.type === 'ReturnStatement'),
  )

  const closeUpvalues = methods.filter(
    ({ fn }) =>
      fn.params.length === 1 &&
      hasNode(context, fn, (node) => thisMember(node, '_openUpvalues')) &&
      hasNode(context, fn, (node) => thisMember(node, '_regs')) &&
      hasNode(context, fn, (node) =>
        slotMember(node, slots.binding, 'FRAME_SIZE', context),
      ) &&
      hasNode(context, fn, (node) =>
        slotMember(node, slots.binding, 'REG_BASE', context),
      ) &&
      methodCall(context, fn, () => true, upvalueClose[0]?.name),
  )

  const run = methods.filter(
    ({ fn }) =>
      fn.params.length === 3 &&
      hasNode(context, fn, (node) => node.type === 'WhileStatement') &&
      hasNode(context, fn, (node) => node.type === 'SwitchStatement') &&
      hasNode(context, fn, (node) => node.type === 'ReturnStatement') &&
      hasNode(
        context,
        fn,
        (node) =>
          node.type === 'MemberExpression' &&
          !node.computed &&
          context.sameRef(node.object, op.binding),
      ),
  )

  return { operand, pushFrame, captureUpvalue, constant, closeUpvalues, run }
}

export function bootGraph(context, declarations, roles) {
  const variables = topLevelVariables(declarations)
  const globals = variables.filter(
    (candidate) =>
      isIdentifier(candidate.init, 'globalThis') &&
      isStableDeclaration(candidate),
  )
  const globalBinding = uniqueCandidate(globals, 'global object binding')
  const vmRoots = variables.filter(
    (candidate) =>
      candidate.init?.type === 'NewExpression' &&
      context.sameRef(candidate.init.callee, roles.vm.binding),
  )
  const rootCandidates = vmRoots.filter((candidate) => {
    const args = candidate.init.arguments
    return (
      args.length === 3 &&
      args[0]?.type === 'CallExpression' &&
      args[0].arguments.length === 1 &&
      context.sameRef(args[0].arguments[0], roles.words.binding) &&
      context.sameRef(args[1], roles.pool.binding) &&
      context.sameRef(args[2], globalBinding.binding)
    )
  })
  const vmRoot = uniqueCandidate(rootCandidates, 'root VM binding')
  const decoderBinding = context.bindingFor(vmRoot.init.arguments[0].callee)
  const decoder = declarations.filter(
    (candidate) =>
      candidate.kind === 'function' && candidate.binding === decoderBinding,
  )
  const decoderRole = uniqueCandidate(decoder, 'bytecode decoder binding')
  const calls = context
    .nodes(context.program)
    .filter(
      ({ node }) =>
        node.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        !node.callee.computed &&
        context.sameRef(node.callee.object, vmRoot.binding),
    )
  if (calls.length !== 1) {
    decline('ambiguous-role', 'Expected exactly one root VM method call')
  }
  const rootCall = calls[0].node
  const args = rootCall.arguments
  if (
    args.length !== 3 ||
    args[0]?.type !== 'NewExpression' ||
    !context.sameRef(args[0].callee, roles.closure.binding) ||
    args[1]?.type !== 'Identifier' ||
    args[1].name !== 'undefined' ||
    context.bindingFor(args[1]) ||
    args[2]?.type !== 'NullLiteral'
  ) {
    decline('altered-boot', 'Root VM boot call is not the pinned Closure form')
  }
  const closureEntries = readPlainObject(args[0].arguments[0])
  if (
    !closureEntries ||
    closureEntries.size !== 3 ||
    numberValue(closureEntries.get('paramCount')) !== 0
  ) {
    decline('malformed-role', 'Root Closure descriptor is malformed')
  }
  const start = context.bindingFor(closureEntries.get('startPc'))
  const regCount = context.bindingFor(closureEntries.get('regCount'))
  if (!start || !regCount) {
    decline('missing-role', 'Root Closure descriptor lacks scalar bindings')
  }
  const scalar = (binding, role) => {
    const candidate = variables.find((item) => item.binding === binding)
    if (!candidate || scalarValue(candidate.init) === undefined) {
      decline('missing-role', `Missing ${role} scalar binding`)
    }
    return candidate
  }
  const startRole = scalar(start, 'MAIN_START_PC')
  const regRole = scalar(regCount, 'MAIN_REG_COUNT')
  if (
    scalarValue(startRole.init) !== 0 ||
    !Number.isSafeInteger(scalarValue(regRole.init)) ||
    scalarValue(regRole.init) <= 0
  ) {
    decline(
      'altered-boot',
      'Root scalar values do not describe the baseline frame',
    )
  }
  if (
    referenceCount(context, startRole.binding) !== 1 ||
    referenceCount(context, regRole.binding) !== 1
  ) {
    decline('ambiguous-role', 'Root scalar bindings have unexpected references')
  }
  return {
    closure: roles.closure,
    decoder: decoderRole,
    globals: globalBinding,
    regCount: regRole,
    rootCall,
    start: startRole,
    vm: vmRoot,
  }
}

function decoderUsesNumericPath(context, decoder, encode) {
  const parameter = parameterBinding(context, decoder.init, 0)
  return (
    hasNode(
      context,
      decoder.init,
      (node) =>
        node.type === 'IfStatement' &&
        node.test?.type === 'UnaryExpression' &&
        node.test.operator === '!' &&
        context.sameRef(node.test.argument, encode.binding) &&
        node.consequent?.type === 'ReturnStatement' &&
        context.sameRef(node.consequent.argument, parameter),
    ) &&
    hasNode(
      context,
      decoder.init,
      (node) =>
        node.type === 'NewExpression' &&
        isIdentifier(node.callee, 'Uint32Array'),
    )
  )
}

export function identifyScalars(context, declarations, roles, boot) {
  const variables = topLevelVariables(declarations)
  const scalars = variables.filter(
    (candidate) => scalarValue(candidate.init) !== undefined,
  )
  const encodedCandidates = scalars.filter(
    (candidate) =>
      scalarValue(candidate.init) === true &&
      hasNode(
        context,
        boot.decoder.init,
        (node) =>
          node.type === 'IfStatement' &&
          node.test?.type === 'UnaryExpression' &&
          node.test.operator === '!' &&
          context.sameRef(node.test.argument, candidate.binding),
      ),
  )
  if (encodedCandidates.length === 1) {
    decline(
      'unsupported-encoded-bytecode',
      'ENCODE_BYTECODE=true is outside the numeric-wordcode boundary',
    )
  }
  if (encodedCandidates.length > 1) {
    decline('ambiguous-role', 'Ambiguous ENCODE_BYTECODE scalar')
  }
  const encodeCandidates = scalars.filter(
    (candidate) =>
      scalarValue(candidate.init) === false &&
      referenceCount(context, candidate.binding) === 1 &&
      decoderUsesNumericPath(context, boot.decoder, candidate),
  )
  const encode = uniqueCandidate(encodeCandidates, 'ENCODE_BYTECODE scalar')

  const frameStartCandidates = scalars.filter(
    (candidate) =>
      scalarValue(candidate.init) === 1 &&
      candidate.binding === roles.vmShape.frameStartBinding &&
      referenceCount(context, candidate.binding, roles.vm.init) === 1 &&
      referenceCount(context, candidate.binding) === 1,
  )
  const frameStart = uniqueCandidate(frameStartCandidates, 'FRAME_START scalar')

  const headerCandidates = scalars.filter(
    (candidate) =>
      scalarValue(candidate.init) === 8 &&
      referenceCount(
        context,
        candidate.binding,
        roles.vmMethods.pushFrame[0].fn,
      ) === 2 &&
      hasNode(context, roles.vmMethods.pushFrame[0].fn, (node) => {
        const parts = binaryParts(node)
        return (
          !!parts &&
          parts.some((part) => context.sameRef(part, candidate.binding)) &&
          parts.some((part) => member(part, () => true, 'regCount'))
        )
      }),
  )
  const header = uniqueCandidate(headerCandidates, 'HEADER_SIZE scalar')

  const timingCandidates = variables.filter(
    (candidate) =>
      referenceCount(context, candidate.binding, roles.vmMethods.run[0].fn) ===
        2 &&
      hasNode(
        context,
        roles.vmMethods.run[0].fn,
        (node) =>
          node.type === 'IfStatement' &&
          context.sameRef(node.test, candidate.binding),
      ) &&
      hasNode(
        context,
        roles.vmMethods.run[0].fn,
        (node) =>
          node.type === 'BinaryExpression' &&
          context.sameRef(node.right, candidate.binding),
      ),
  )
  const timing = uniqueCandidate(timingCandidates, 'TIMING_CHECKS scalar')

  if (
    !encode ||
    !frameStart ||
    !header ||
    !timing ||
    scalarValue(encode.init) !== false
  ) {
    decline('malformed-role', 'Pinned scalar roles are inconsistent')
  }
  roles.headerBinding = header.binding
  return { encode, frameStart, header, timing }
}
