import fs from 'node:fs'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { diagnoseMinifiedClassBoot } from '../../../src/vm/jsconfuser-vm/observe-minified-class-boot.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'

const seeds = [169, 170, 171]
function fixture(name) {
  return fs.readFileSync(
    new URL(`fixtures/minified-class-boot/${name}`, import.meta.url),
    'utf8',
  )
}
function setup(seed) {
  const source = fixture(`encoded-${seed}.js`)
  const baseline = diagnoseMinifiedClassBoot(source)
  expect(baseline.ok).toBe(true)
  const ast = parse(source, { sourceType: 'script' })
  let selected
  const functions = []
  traverse(ast, {
    SwitchCase(path) {
      if (path.node.test?.value === 0) selected = path
    },
    Function(path) {
      functions.push(path)
    },
  })
  const destination = selected.node.consequent[0].declarations[0]
  const write = selected.node.consequent[1].expression
  const operandBinding = selected.scope.getBinding(destination.init.callee.name)
  const call = write.right
  const constant =
    call.callee.type === 'Identifier'
      ? selected.scope.getBinding(call.callee.name).path
      : functions.find(
          (path) =>
            path.parentPath.isAssignmentExpression() &&
            path.parentPath.node.left.property.name ===
              call.callee.property.name,
        )
  let bytes
  constant.traverse({
    CallExpression(path) {
      if (
        path.node.arguments.length === 1 &&
        path.node.callee.type === 'Identifier'
      ) {
        const binding = path.scope.getBinding(path.node.callee.name)
        if (binding !== operandBinding) bytes = binding.path
      }
    },
  })
  return {
    ast,
    source,
    baseline,
    selected,
    destination,
    write,
    operand: operandBinding.path,
    constant,
    bytes,
  }
}
function observeAst(ast) {
  return diagnoseMinifiedClassBoot(generate(ast).code)
}
function first(path, predicate) {
  let result
  path.traverse({
    enter(child) {
      if (!result && predicate(child.node)) result = child.node
    },
  })
  expect(result).toBeDefined()
  return result
}
const controls = [
  [
    'operand receiver',
    'LOAD_CONST reader uses a different VM receiver',
    (s) => {
      s.destination.init.arguments[0] = {
        type: 'ObjectExpression',
        properties: [],
      }
    },
  ],
  [
    'constant receiver',
    'LOAD_CONST reader uses a different VM receiver',
    (s) => {
      const empty = { type: 'ObjectExpression', properties: [] }
      if (s.write.right.callee.type === 'Identifier')
        s.write.right.arguments[0] = empty
      else s.write.right.callee.object = empty
    },
  ],
  [
    'word field',
    'LOAD_CONST operand reader does not read and advance observed frame PC',
    (s) => {
      s.operand.node.body.body[0].argument.object.property.name =
        s.baseline.result.fields.pool
    },
  ],
  [
    'operand increment',
    'LOAD_CONST operand reader does not read and advance observed frame PC',
    (s) => {
      first(s.operand, (n) => n.type === 'UpdateExpression').prefix = true
    },
  ],
  [
    'operand PC slot',
    'LOAD_CONST operand reader does not read and advance observed frame PC',
    (s) => {
      first(
        s.operand,
        (n) => n.type === 'BinaryExpression' && n.operator === '+',
      ).right.value = 1
    },
  ],
  [
    'extra helper effect',
    'LOAD_CONST constant reader body does not implement observed pool decoding',
    (s) => {
      s.constant.node.body.body.unshift({
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: 'unprovedEffect' },
          arguments: [],
        },
      })
    },
  ],
  [
    'pool field',
    'LOAD_CONST constant reader body does not implement observed pool decoding',
    (s) => {
      first(
        s.constant,
        (n) =>
          n.type === 'MemberExpression' &&
          !n.computed &&
          n.property.name === s.baseline.result.fields.pool,
      ).property.name = s.baseline.result.fields.words
    },
  ],
  [
    'numeric decoder',
    'LOAD_CONST constant reader body does not implement observed pool decoding',
    (s) => {
      first(
        s.constant,
        (n) => n.type === 'BinaryExpression' && n.operator === '^',
      ).operator = '+'
    },
  ],
  [
    'string keystream',
    'LOAD_CONST constant reader body does not implement observed pool decoding',
    (s) => {
      first(
        s.constant,
        (n) => n.type === 'NumericLiteral' && n.value === 2654435769,
      ).value++
    },
  ],
  [
    'byte decoder',
    'LOAD_CONST byte reader does not implement base64 byte conversion',
    (s) => {
      first(
        s.bytes,
        (n) => n.type === 'StringLiteral' && n.value === 'base64',
      ).value = 'utf8'
    },
  ],
  [
    'destination',
    'LOAD_CONST destination is detached from operand register',
    (s) => {
      s.write.left.property.right = { type: 'NumericLiteral', value: 0 }
    },
  ],
  [
    'base slot',
    'LOAD_CONST register base is detached from observed frame slot',
    (s) => {
      const name = s.write.left.property.left.name
      const declaration = first(
        s.selected.getFunctionParent(),
        (n) => n.type === 'VariableDeclarator' && n.id.name === name,
      )
      declaration.init.property.right.value = 6
    },
  ],
]

test.each(seeds)(
  'proves connected retained LOAD_CONST roles %i without execution',
  (seed) => {
    const s = setup(seed)
    expect(s.baseline.result.loadConstant).toEqual({
      opcode: 0,
      operand: { kind: 'helper', pcSlot: 0, advance: 'post-increment' },
      constant: {
        kind: seed === 169 ? 'method' : 'helper',
        operands: ['pool-index', 'conceal-key'],
        incidentalWrites: seed === 170 ? ['Q', 'k'] : [],
      },
      destination: { baseSlot: 7, index: 'first-word-operand' },
      entryEffects:
        seed === 169
          ? {
              scope: 'selected-entry',
              frameDummyWrites: [
                { field: 'n', parameterIndex: 3, argument: 'void 0' },
              ],
              laterHandlers: 'unproved',
            }
          : null,
      completeHandlers: false,
    })
    expect(
      Object.isFrozen(s.baseline.result.loadConstant.constant.incidentalWrites),
    ).toBe(true)
    if (seed === 169)
      expect(
        Object.isFrozen(
          s.baseline.result.loadConstant.entryEffects.frameDummyWrites[0],
        ),
      ).toBe(true)
    const before = generate(s.ast).code
    expect(diagnoseMinifiedClassBoot(s.ast).ok).toBe(true)
    expect(generate(s.ast).code).toBe(before)
    const record = JSON.parse(fixture(`qualification-${seed}.json`))
    expect(
      Object.values(record.provenance.generation).every(
        (value) => value === null,
      ),
    ).toBe(true)
    expect(diagnoseContainer(s.source)).toMatchObject({
      ok: true,
      diagnostic: null,
      result: {
        roles: {
          words: { values: s.baseline.result.words },
          pool: { values: s.baseline.result.pool },
        },
      },
    })
  },
)
for (const seed of seeds) {
  test.each(controls)(
    `source ${seed}: %s reaches its named refusal`,
    (_name, message, damage) => {
      const s = setup(seed)
      damage(s)
      expect(generate(s.ast).code).not.toBe(generate(parse(s.source)).code)
      expect(observeAst(s.ast)).toEqual({
        ok: false,
        result: null,
        diagnostic: { code: 'incomplete-role', message },
      })
      expect(s.baseline.diagnostic).toBeNull()
      expect(s.baseline.result.loadConstant.completeHandlers).toBe(false)
      const opposite = setup(seed)
      if (message.includes('destination')) {
        first(
          opposite.operand,
          (node) => node.type === 'UpdateExpression',
        ).prefix = true
      } else {
        opposite.write.left.property.right = {
          type: 'NumericLiteral',
          value: 0,
        }
      }
      expect(observeAst(opposite.ast).diagnostic.message).not.toBe(message)
    },
  )
}

test.each(seeds)(
  'binding/member renaming and missing offsets preserve proof %i',
  (seed) => {
    const s = setup(seed)
    const bindingNames = new Map()
    const names = new Map()
    const fields = new Set([
      ...Object.values(s.baseline.result.fields),
      s.baseline.result.frame.regs,
      s.baseline.result.frame.top,
      s.baseline.result.frame.frame,
    ])
    traverse(s.ast, {
      AssignmentExpression(path) {
        const member = path.node.left
        if (
          member.type === 'MemberExpression' &&
          member.object.type === 'MemberExpression' &&
          member.object.property.name === 'prototype'
        )
          fields.add(member.property.name)
      },
    })
    for (const name of fields) names.set(name, `renamedField${names.size}`)
    const edits = []
    traverse(s.ast, {
      Identifier(path) {
        if (path.isBindingIdentifier() || path.isReferencedIdentifier()) {
          const binding = path.scope.getBinding(path.node.name)
          if (binding) {
            if (!bindingNames.has(binding))
              bindingNames.set(binding, `renamedBinding${bindingNames.size}`)
            edits.push([path.node, bindingNames.get(binding)])
          }
        }
      },
    })
    for (const [node, name] of edits) node.name = name
    traverse(s.ast, {
      MemberExpression(path) {
        if (!path.node.computed && names.has(path.node.property.name))
          path.node.property.name = names.get(path.node.property.name)
      },
      enter(path) {
        delete path.node.start
        delete path.node.end
      },
    })
    const renamed = generate(s.ast).code
    expect(renamed).not.toBe(s.source)
    const result = diagnoseMinifiedClassBoot(renamed)
    expect(result.ok).toBe(true)
    expect(result.result.loadConstant.constant.kind).toBe(
      s.baseline.result.loadConstant.constant.kind,
    )
    expect(result.result.words).toEqual(s.baseline.result.words)
    expect(result.result.pool).toEqual(s.baseline.result.pool)
    const fresh = parse(renamed, { sourceType: 'script' })
    traverse(fresh, {
      enter(path) {
        delete path.node.start
        delete path.node.end
      },
    })
    // The AST route sees stripped nodes directly; no later parse restores offsets.
    const direct = diagnoseMinifiedClassBoot(fresh)
    expect(direct.ok).toBe(true)
    expect(direct.result).toEqual(result.result)
  },
)

test('VM effect expressions and method ownership have discriminating controls', () => {
  for (const damage of ['field', 'value', 'void-effect']) {
    const s = setup(170)
    const write = first(
      s.constant,
      (n) =>
        n.type === 'AssignmentExpression' &&
        n.left.type === 'MemberExpression' &&
        n.right.type === 'UnaryExpression',
    )
    if (damage === 'field')
      write.left.property.name = s.baseline.result.frame.regs
    if (damage === 'value') write.right = { type: 'NumericLiteral', value: 1 }
    if (damage === 'void-effect')
      write.right.argument = {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'unprovedEffect' },
        arguments: [],
      }
    expect(observeAst(s.ast).diagnostic).toEqual({
      code: 'incomplete-role',
      message: 'LOAD_CONST constant reader has unsupported VM field effects',
    })
  }
  const other = setup(169)
  other.constant.parentPath.node.left.object.object.name = 'unownedConstructor'
  expect(observeAst(other.ast).diagnostic).toEqual({
    code: 'incomplete-role',
    message: 'LOAD_CONST reader method is detached from VM prototype',
  })
  const late = setup(169)
  const statement = late.constant.parentPath.parentPath.node
  late.ast.program.body.splice(late.ast.program.body.indexOf(statement), 1)
  late.ast.program.body.push(statement)
  expect(observeAst(late.ast).diagnostic).toEqual({
    code: 'incomplete-role',
    message: 'LOAD_CONST reader method is detached from VM prototype',
  })
  expect(observeAst(setup(171).ast).ok).toBe(true)
})

test('dispatch aliases and overwritten state reach their selected role check', () => {
  const s = setup(169)
  const baseName = s.write.left.property.left.name
  const baseDeclaration = first(
    s.selected.getFunctionParent(),
    (node) => node.type === 'VariableDeclarator' && node.id.name === baseName,
  )
  const basePath = s.selected.scope.getBinding(baseName).path.parentPath
  basePath.insertAfter({
    type: 'ExpressionStatement',
    expression: {
      type: 'AssignmentExpression',
      operator: '=',
      left: { type: 'Identifier', name: baseDeclaration.id.name },
      right: { type: 'NumericLiteral', value: 0 },
    },
  })
  expect(observeAst(s.ast).diagnostic).toEqual({
    code: 'incomplete-role',
    message: 'LOAD_CONST dispatch role bindings are overwritten or aliased',
  })
  const other = setup(169)
  const fn = other.selected.getFunctionParent()
  fn.node.body.body.unshift({
    type: 'ExpressionStatement',
    expression: {
      type: 'AssignmentExpression',
      operator: '=',
      left: { ...fn.node.params[0] },
      right: { type: 'ObjectExpression', properties: [] },
    },
  })
  expect(observeAst(other.ast).diagnostic).toEqual({
    code: 'incomplete-role',
    message: 'LOAD_CONST dispatch VM receiver is overwritten',
  })
  expect(observeAst(setup(169).ast).ok).toBe(true)
})

function roleRead(s, fieldName) {
  let found
  s.selected.getFunctionParent().traverse({
    enter(path) {
      const node = path.node
      const value =
        node.type === 'VariableDeclarator'
          ? node.init
          : node.type === 'AssignmentExpression'
            ? node.right
            : null
      if (
        !found &&
        value?.type === 'MemberExpression' &&
        !value.computed &&
        value.property.name === fieldName
      )
        found = path
    },
  })
  expect(found).toBeDefined()
  return found
}
function parsedStatements(code) {
  return parse(code).program.body
}
function namedRefusal(s, message) {
  expect(observeAst(s.ast)).toEqual({
    ok: false,
    result: null,
    diagnostic: { code: 'incomplete-role', message },
  })
  expect(s.baseline.ok).toBe(true)
  const opposite = setup(169)
  opposite.write.left.property.right = { type: 'NumericLiteral', value: 0 }
  expect(observeAst(opposite.ast).diagnostic.message).not.toBe(message)
}

for (const role of ['base', 'regs', 'fp', 'receiver']) {
  for (const operation of [
    'compound',
    'update',
    'conditional',
    'destructuring',
    'object-destructuring',
    'iteration',
    'nested',
  ]) {
    test(`LOAD_CONST live ${role}: ${operation} writes reach stability refusal`, () => {
      const s = setup(169)
      const fn = s.selected.getFunctionParent()
      const path =
        role === 'base'
          ? s.selected.scope.getBinding(s.write.left.property.left.name).path
          : role === 'regs'
            ? roleRead(s, s.baseline.result.frame.regs)
            : role === 'fp'
              ? roleRead(s, s.baseline.result.frame.frame)
              : null
      const name =
        role === 'receiver'
          ? fn.node.params[0].name
          : (path.node.id ?? path.node.left).name
      const code = {
        compound: `${name}+=1;`,
        update: `${name}++;`,
        conditional: `if(true)${name}=0;`,
        destructuring: `[${name}]=[0];`,
        'object-destructuring': `({value:${name}}={value:0});`,
        iteration: `for(${name} of [0]){}`,
        nested: `{if(true){${name}=0;}}`,
      }[operation]
      if (path) path.getStatementParent().insertAfter(parsedStatements(code))
      else fn.node.body.body.unshift(...parsedStatements(code))
      namedRefusal(
        s,
        role === 'receiver'
          ? 'LOAD_CONST dispatch VM receiver is overwritten'
          : 'LOAD_CONST dispatch role bindings are overwritten or aliased',
      )
    })
  }
}

test('LOAD_CONST defining reads must precede the dependent base read', () => {
  const s = setup(169)
  const basePath = s.selected.scope.getBinding(s.write.left.property.left.name)
    .path.parentPath
  const statement = basePath.node
  basePath.remove()
  const loop = s.selected.findParent((path) => path.isForStatement())
  loop.node.body.body.unshift(statement)
  namedRefusal(s, 'LOAD_CONST register base read precedes its frame inputs')
  const positive = setup(169)
  const regs = roleRead(
    positive,
    positive.baseline.result.frame.regs,
  ).getStatementParent()
  const frame = roleRead(
    positive,
    positive.baseline.result.frame.frame,
  ).getStatementParent()
  const original = regs.node
  regs.remove()
  frame.insertBefore(original)
  expect(observeAst(positive.ast).ok).toBe(true)
})

const methodDamages = [
  [
    'computed member overwrite',
    'selected method is overwritten, deleted or shadowed',
    (ctor, name) => `${ctor}.prototype[${JSON.stringify(name)}]=2;`,
  ],
  [
    'known alias overwrite',
    'selected method is overwritten, deleted or shadowed',
    (ctor, name) =>
      `var proofProto=${ctor}.prototype;proofProto[${JSON.stringify(name)}]=2;`,
  ],
  [
    'member deletion',
    'selected method is overwritten, deleted or shadowed',
    (ctor, name) => `delete ${ctor}.prototype[${JSON.stringify(name)}];`,
  ],
  [
    'prototype replacement',
    'selected method prototype is replaced or deleted',
    (ctor) => `${ctor}["prototype"]={};`,
  ],
  [
    'prototype deletion',
    'selected method prototype is replaced or deleted',
    (ctor) => `delete ${ctor}.prototype;`,
  ],
  [
    'unknown prototype escape',
    'selected method prototype escapes the owned graph',
    (ctor) => `unprovedEffect(${ctor}.prototype);`,
  ],
  [
    'unknown property key',
    'selected method ownership has an unknown property write',
    (ctor) => `${ctor}.prototype[unprovedKey]=2;`,
  ],
  [
    'unstable constructor',
    'VM constructor binding is unstable',
    (ctor) => `${ctor}=unprovedConstructor;`,
  ],
  [
    'unstable prototype alias',
    'selected method prototype alias is unstable',
    (ctor) => `var proofProto=${ctor}.prototype;proofProto={};`,
  ],
  [
    'indirect member effect',
    'selected method ownership has an indirect property effect',
    (ctor, name) =>
      `Object.defineProperty(${ctor}.prototype,${JSON.stringify(name)},{value:2});`,
  ],
]
test.each(methodDamages)(
  'LOAD_CONST ownership refuses %s',
  (_name, suffix, mutation) => {
    const s = setup(169)
    const statement = s.constant.parentPath.parentPath
    const member = s.constant.parentPath.node.left
    statement.insertAfter(
      parsedStatements(
        mutation(member.object.object.name, member.property.name),
      ),
    )
    namedRefusal(s, `LOAD_CONST ${suffix}`)
  },
)
test('LOAD_CONST constructor instance shadow refuses at selected ownership', () => {
  const s = setup(169)
  const member = s.constant.parentPath.node.left
  const ctor = s.constant.scope.getBinding(member.object.object.name).path.node
  ctor.body.body.push(
    ...parsedStatements(`this[${JSON.stringify(member.property.name)}]=2;`),
  )
  namedRefusal(
    s,
    'LOAD_CONST selected method is overwritten, deleted or shadowed',
  )
})
test('LOAD_CONST stable unused prototype alias preserves selected ownership', () => {
  const s = setup(169)
  const member = s.constant.parentPath.node.left
  s.constant.parentPath.parentPath.insertAfter(
    parsedStatements(`var proofProto=${member.object.object.name}.prototype;`),
  )
  expect(observeAst(s.ast).ok).toBe(true)
})

test('LOAD_CONST unknown prelude receiver escape refuses selected ownership', () => {
  const s = setup(169)
  const fn = s.selected.getFunctionParent()
  fn.node.body.body.unshift(
    ...parsedStatements(`unprovedEffect(${fn.node.params[0].name});`),
  )
  namedRefusal(
    s,
    'LOAD_CONST selected VM receiver escapes before the selected call',
  )
})
test('LOAD_CONST prelude helper receiver escape refuses selected ownership', () => {
  const s = setup(169)
  const fn = s.selected.getFunctionParent()
  const init = fn.node.body.body.find(
    (node) => node.type === 'ForStatement',
  ).init
  const frameCall = init.type === 'CallExpression' ? init : init.expressions[0]
  const frame = fn.scope.getBinding(frameCall.callee.name).path.node
  frame.body.body.unshift(
    ...parsedStatements(`unprovedEffect(${frame.params[0].name});`),
  )
  namedRefusal(
    s,
    'LOAD_CONST selected VM receiver has an unknown prelude helper effect',
  )
})
test('LOAD_CONST nested closure write is included in the stability interval', () => {
  const s = setup(169)
  const name = s.write.left.property.left.name
  const path = s.selected.scope.getBinding(name).path.parentPath
  path.insertAfter(
    parsedStatements(`function unprovedWrite(){${name}++}unprovedWrite();`),
  )
  namedRefusal(
    s,
    'LOAD_CONST dispatch role bindings are overwritten or aliased',
  )
})

test('LOAD_CONST unknown prelude VM method call refuses selected ownership', () => {
  const s = setup(169)
  const fn = s.selected.getFunctionParent()
  fn.node.body.body.unshift(
    ...parsedStatements(`${fn.node.params[0].name}.unprovedMethod();`),
  )
  namedRefusal(
    s,
    'LOAD_CONST selected VM receiver has an unknown prelude method effect',
  )
})

function entryFrame(s) {
  const dispatch = s.selected.getFunctionParent()
  const loop = dispatch.node.body.body.find(
    (node) => node.type === 'ForStatement',
  )
  return dispatch.scope.getBinding(loop.init.callee.name).path
}
for (const site of ['dispatch', 'frame']) {
  test(`LOAD_CONST implicit arguments receiver at ${site} reaches closed effect refusal`, () => {
    const s = setup(169)
    const name = s.write.right.callee.property.name
    const fn =
      site === 'dispatch' ? s.selected.getFunctionParent() : entryFrame(s)
    fn.node.body.body.unshift(
      ...parsedStatements(
        `var reviewKey=${JSON.stringify(name)};arguments[0][reviewKey]=2;`,
      ),
    )
    const message =
      site === 'dispatch'
        ? 'LOAD_CONST dispatch effects are outside the closed entry shape'
        : 'LOAD_CONST frame helper effects are outside the closed entry shape'
    namedRefusal(s, message)
    const opposite = setup(169)
    const dispatch = opposite.selected.getFunctionParent()
    dispatch.node.body.body.unshift(
      ...parsedStatements(`unprovedEffect(${dispatch.node.params[0].name});`),
    )
    expect(observeAst(opposite.ast).diagnostic.message).toBe(
      'LOAD_CONST selected VM receiver escapes before the selected call',
    )
    expect(observeAst(opposite.ast).diagnostic.message).not.toBe(message)
  })
  for (const effect of ['global-call', 'reflection', 'implicit-this']) {
    test(`LOAD_CONST ${site} ${effect} refuses the positive closed effect shape`, () => {
      const s = setup(169)
      const fn =
        site === 'dispatch' ? s.selected.getFunctionParent() : entryFrame(s)
      const code = {
        'global-call': 'globalThis.unprovedEffect();',
        reflection: 'Reflect.set(arguments[0],unprovedKey,2);',
        'implicit-this': 'this[unprovedKey]=2;',
      }[effect]
      fn.node.body.body.unshift(...parsedStatements(code))
      namedRefusal(
        s,
        site === 'dispatch'
          ? 'LOAD_CONST dispatch effects are outside the closed entry shape'
          : 'LOAD_CONST frame helper effects are outside the closed entry shape',
      )
    })
  }
}
test('LOAD_CONST unknown constructor call refuses its positive closed effect shape', () => {
  const s = setup(169)
  const ctor = s.constant.scope.getBinding(
    s.constant.parentPath.node.left.object.object.name,
  ).path.node
  ctor.body.body.push(...parsedStatements('globalThis.unprovedEffect();'))
  namedRefusal(
    s,
    'LOAD_CONST constructor effects are outside the closed entry shape',
  )
})
test('LOAD_CONST nested frame helper refuses the claimed Program-parent ownership gate', () => {
  const s = setup(169)
  const helper = entryFrame(s)
  const fn = helper.node
  helper.remove()
  s.selected.getFunctionParent().node.body.body.unshift(fn)
  namedRefusal(
    s,
    'LOAD_CONST selected VM receiver escapes before the selected call',
  )
})

test('LOAD_CONST frame dummy write cannot replace an initialized payload field', () => {
  const s = setup(169)
  const frame = entryFrame(s)
  const field =
    s.baseline.result.loadConstant.entryEffects.frameDummyWrites[0].field
  first(
    frame,
    (node) =>
      node.type === 'MemberExpression' &&
      !node.computed &&
      node.property.name === field,
  ).property.name = s.baseline.result.fields.pool
  namedRefusal(
    s,
    'LOAD_CONST frame helper effects are outside the closed entry shape',
  )
})

test('LOAD_CONST frame call argument execution refuses closed entry effects', () => {
  const s = setup(169)
  const loop = s.selected
    .getFunctionParent()
    .node.body.body.find((node) => node.type === 'ForStatement')
  loop.init.arguments[1] = parsedStatements(
    '(globalThis.unprovedEffect(),null);',
  )[0].expression
  namedRefusal(
    s,
    'LOAD_CONST frame call effects are outside the closed entry shape',
  )
})
test('LOAD_CONST root frame argument setup stays within the proved no-arguments entry', () => {
  const s = setup(169)
  const name = s.selected.getFunctionParent().node.id.name
  const boot = s.ast.program.body.find(
    (node) =>
      node.expression?.type === 'CallExpression' &&
      node.expression.callee.name === name,
  )
  boot.expression.arguments[1] = { type: 'ArrayExpression', elements: [] }
  namedRefusal(
    s,
    'LOAD_CONST root frame arguments are outside the closed entry shape',
  )
})

for (const seed of seeds)
  test(`${seed}: Buffer.from comma value is one argument, not two`, () => {
    const state = setup(seed)
    const call = first(
      state.bytes,
      (node) =>
        node.type === 'CallExpression' &&
        node.callee.object?.name === 'Buffer' &&
        node.callee.property.name === 'from',
    )
    expect(call.arguments).toHaveLength(2)
    call.arguments = [
      { type: 'SequenceExpression', expressions: call.arguments },
    ]
    expect(observeAst(state.ast)).toEqual({
      ok: false,
      result: null,
      diagnostic: {
        code: 'incomplete-role',
        message:
          'LOAD_CONST byte reader does not implement base64 byte conversion',
      },
    })
  })
