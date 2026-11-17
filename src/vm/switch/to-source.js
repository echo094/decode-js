import * as t from '@babel/types'
import { parse } from '@babel/parser'
import { generate } from '@babel/generator'
import _traverse from '@babel/traverse'
import {
  closureCaptures,
  emitHandlerRegisterAssignment,
  emitInstruction,
} from './emit/render.js'
import { functionHead, functionName, functionNode } from './model/operations.js'
import { decline } from './model/model.js'
import { emitStructuredFunction } from './emit/structured-emitter.js'
import { planStatements } from './statements/plan-statements.js'
import { solveControl } from './model/control.js'

const traverse = _traverse.default ?? _traverse

const name = (text) => t.identifier(text)
const field = (object, key) => t.memberExpression(name(object), name(key))
const assign = (left, right) =>
  t.expressionStatement(t.assignmentExpression('=', left, right))
const resumeAtHandler = () => [
  assign(name('__recovered_pc'), field('__recovered_handler', 'target')),
  t.continueStatement(name('__recovered_dispatch')),
]
const throwError = (message) =>
  t.throwStatement(t.newExpression(name('Error'), [t.stringLiteral(message)]))

// The dispatch rendering's handler: the innermost record taken off the stack; a catch record
// writes the exception to its register and resumes at its handler, a finally record writes the
// throw pad as its continuation and the exception as its payload and resumes at its finalizer.
function dispatchHandler(functionId, registerCount) {
  const write = (property, value) =>
    emitHandlerRegisterAssignment(functionId, registerCount, property, value)
  return t.catchClause(
    name('__recovered_error'),
    t.blockStatement([
      t.variableDeclaration('const', [
        t.variableDeclarator(
          name('__recovered_handler'),
          t.callExpression(field('__recovered_handlers', 'pop'), []),
        ),
      ]),
      t.ifStatement(
        t.unaryExpression('!', name('__recovered_handler')),
        t.throwStatement(name('__recovered_error')),
      ),
      t.ifStatement(
        t.binaryExpression(
          '===',
          field('__recovered_handler', 'kind'),
          t.stringLiteral('catch'),
        ),
        t.blockStatement([
          write('register', name('__recovered_error')),
          ...resumeAtHandler(),
        ]),
      ),
      write('continuation', field('__recovered_handler', 'throwPad')),
      write('payload', name('__recovered_error')),
      ...resumeAtHandler(),
    ]),
  )
}

// The dispatch rendering of one function: its whole register frame, every case under the PC
// dispatch loop.
function emitStateMachineFunction(frame, instructions, functionRecord) {
  const { functionId } = frame
  const hasHandlerSetup = instructions.some(({ operation }) =>
    ['catch-setup', 'finally-setup'].includes(operation.kind),
  )
  const usesHandlers =
    hasHandlerSetup ||
    instructions.some(({ operation }) => operation.kind === 'handler-pop')
  const head = functionHead(
    frame,
    functionRecord,
    instructions,
    new Set(Array.from({ length: functionRecord.regCount }, (_, r) => r)),
  )
  const dispatch = t.switchStatement(name('__recovered_pc'), [
    ...instructions.map((instruction) =>
      t.switchCase(t.numericLiteral(instruction.pc), [
        t.blockStatement(emitInstruction(frame, instruction)),
      ]),
    ),
    t.switchCase(null, [throwError('Invalid recovered control state')]),
  ])
  const body = [
    ...(usesHandlers
      ? [
          t.variableDeclaration('const', [
            t.variableDeclarator(
              name('__recovered_handlers'),
              t.arrayExpression([]),
            ),
          ]),
        ]
      : []),
    t.variableDeclaration('let', [
      t.variableDeclarator(
        name('__recovered_pc'),
        t.numericLiteral(functionRecord.startPc),
      ),
    ]),
    t.labeledStatement(
      name('__recovered_dispatch'),
      t.whileStatement(
        t.booleanLiteral(true),
        t.blockStatement([
          hasHandlerSetup
            ? t.tryStatement(
                t.blockStatement([dispatch]),
                dispatchHandler(functionId, functionRecord.regCount),
              )
            : dispatch,
        ]),
      ),
    ),
  ]
  return functionNode(frame, head, body)
}

// The functions a structured program runs: the root, then every function a reachable closure
// creates. A function only unreachable code creates is not part of the recovered program.
function reachableFunctions(model) {
  const byStart = new Map(
    model.functions.functions.map((record) => [record.startPc, record]),
  )
  const solvedById = new Map()
  const pending = [model.functions.functions[0]]
  while (pending.length > 0) {
    const functionRecord = pending.pop()
    if (solvedById.has(functionRecord.id)) continue
    const cases = model.instructionsByFunction.get(functionRecord.id)
    const solved = solveControl(functionRecord, cases)
    solvedById.set(functionRecord.id, solved)
    const reachablePcs = new Set(solved.reachablePcs)
    for (const { pc, operation } of cases) {
      if (operation.kind !== 'closure' || !reachablePcs.has(pc)) continue
      const child = byStart.get(operation.entry)
      // A missing entry declines when the closure renders.
      if (child) pending.push(child)
    }
  }
  return solvedById
}

// The enumeration helper a setup enumerates through, written at the program's top.
const ENUMERATION_HELPER = parse(`
function __recovered_enumerable_keys(__value) {
  const __keys = [];
  if (__value === null || __value === void 0) return __keys;
  const __seen = Object.create(null);
  let __current = Object(__value);
  while (__current !== null) {
    for (const __key of Object.getOwnPropertyNames(__current)) {
      if (__key in __seen) continue;
      __seen[__key] = true;
      const __descriptor = Object.getOwnPropertyDescriptor(__current, __key);
      if (__descriptor && __descriptor.enumerable) __keys.push(__key);
    }
    __current = Object.getPrototypeOf(__current);
  }
  return __keys;
}`).program.body[0]

// The closure sites the function's rendering writes: every reachable one, or every one in the
// review rendering (no `solved`).
function closureSites(cases, solved) {
  const reachablePcs = solved ? new Set(solved.reachablePcs) : null
  return cases.filter(
    ({ pc, operation }) =>
      operation.kind === 'closure' && (!reachablePcs || reachablePcs.has(pc)),
  )
}

/**
 * The program's functions rendered from the root, with what each rendering reports: its
 * simplification proofs (`functionSimplifications`), its statement regions (`statements`), whether
 * a setup enumerates through the helper (`enumerationHelper`), and the instructions proved
 * unreachable (`provenUnreachable`, from unreachable functions and unreachable cases).
 */
class ProgramEmitter {
  constructor(model, dispatch) {
    this.model = model
    this.dispatch = dispatch
    // Every function is emitted structured, unless the caller asks for the review rendering,
    // which emits every case of every function as dispatch, reachable or not.
    this.solvedById = dispatch ? null : reachableFunctions(model)
    this.root = model.functions.functions[0]
    this.byStart = new Map(
      model.functions.functions.map((record) => [record.startPc, record]),
    )
    this.functionSimplifications = []
    this.statements = []
    // The enumeration helper is written when an emitted setup enumerates through it: every setup
    // in the review rendering, a structured setup no `for (key in object)` holds.
    this.enumerationHelper = false
    this.provenUnreachable = 0
    this.unreachableFunctions = 0
    for (const functionRecord of model.functions.functions)
      if (!dispatch && !this.solvedById.has(functionRecord.id)) {
        this.provenUnreachable += model.instructionsByFunction.get(
          functionRecord.id,
        ).length
        this.unreachableFunctions += 1
      }
  }

  // A function is written where a closure creates it, as a function expression reading the
  // registers that site captures lexically; the root alone is a declaration. Its closures are
  // written first, children before their parent: the frame hands the renderer each closure site's
  // function expression (`closures`, PC -> node) as data.
  render(functionRecord, captures) {
    const cases = this.model.instructionsByFunction.get(functionRecord.id)
    const frame = {
      functionId: functionRecord.id,
      root: functionRecord === this.root,
      captures,
    }
    const solved = this.dispatch ? null : this.solvedById.get(functionRecord.id)
    const regions = solved
      ? planStatements(functionRecord, cases, solved)
      : null
    if (regions)
      this.statements.push({ functionId: functionRecord.id, regions })
    frame.closures = new Map(
      closureSites(cases, solved).map((site) => [
        site.pc,
        this.closureNode(frame, site),
      ]),
    )
    const emitted = solved
      ? emitStructuredFunction(frame, cases, functionRecord, regions, solved)
      : {
          node: emitStateMachineFunction(frame, cases, functionRecord),
          unreachableCount: 0,
          copyProofs: [],
          deadProofs: [],
          enumerationHelper: cases.some(
            ({ operation }) => operation.kind === 'for-in-setup',
          ),
        }
    this.provenUnreachable += emitted.unreachableCount
    if (emitted.enumerationHelper) this.enumerationHelper = true
    this.functionSimplifications.push({
      functionId: functionRecord.id,
      copies: emitted.copyProofs,
      deadDefinitions: emitted.deadProofs,
    })
    return emitted.node
  }

  closureNode(frame, { operation }) {
    const childCaptures = closureCaptures(frame, operation)
    const child = this.byStart.get(operation.entry)
    if (!child)
      decline(
        'missing-closure-function',
        `Closure points at missing function entry ${operation.entry}`,
      )
    return this.render(child, childCaptures)
  }
}

export function emitVmSwitchProgram(model, { dispatch = false } = {}) {
  const program = new ProgramEmitter(model, dispatch)
  const { root } = program
  const rootFunction = program.render(root, [])
  const tree = t.file(
    t.program([
      t.expressionStatement(
        t.callExpression(
          t.functionExpression(
            null,
            [],
            t.blockStatement([
              ...(program.enumerationHelper
                ? [t.cloneNode(ENUMERATION_HELPER)]
                : []),
              rootFunction,
              t.expressionStatement(
                t.callExpression(name(functionName(root.id)), []),
              ),
            ]),
          ),
          [],
        ),
      ),
    ]),
  )
  const byFunction = (left, right) => left.functionId - right.functionId
  const functionSimplifications =
    program.functionSimplifications.sort(byFunction)
  const statements = program.statements.sort(byFunction)
  const eliminated = functionSimplifications.flatMap(
    ({ copies: proofs, deadDefinitions }) => [...proofs, ...deadDefinitions],
  )
  writeForClauses(tree)
  const output = generate(tree).code
  // A fresh parse of the printed program checks what the builders do not: early errors such as a
  // transfer to a label no statement holds.
  parseEmittedJavaScript(output)
  const { provenUnreachable, unreachableFunctions } = program
  return {
    output,
    statements,
    simplification: {
      schemaVersion: 'vm-switch-simplification.v1',
      functions: functionSimplifications,
      summary: {
        emitted: model.instructionCount - eliminated.length - provenUnreachable,
        safelyEliminated: eliminated.length,
        provenUnreachable,
        unreachableFunctions,
      },
    },
  }
}

// The compiler writes `for (init; test; update) body` as `init; while (test) { body; update }`
// when no `continue` enters the update, so the two read alike in the program. A loop is written
// with its clauses when the statement before it writes a register its test reads and its body's
// last statement writes that register again, and no `continue` in the body targets the loop: such
// a continue skips the body's last write, which an update would run. A loop that already has its
// update (a continue target) takes the write before it as its init when the update writes that
// register. Moving a statement into `init` or `update` keeps its evaluation where it was.
function writeForClauses(tree) {
  traverse(tree, {
    'Program|BlockStatement|SwitchCase': {
      exit(path) {
        foldForClauses(path, path.isSwitchCase() ? 'consequent' : 'body')
      },
    },
  })
}

// Folds the loops in one statement list (`container`'s `key`), last first.
function foldForClauses(container, key) {
  const statements = container.node[key]
  for (let index = statements.length - 1; index > 0; index--) {
    const statement = statements[index]
    const labeled = t.isLabeledStatement(statement)
    const loop = labeled ? statement.body : statement
    const register = registerWritten(statements[index - 1])
    if (register === null) continue
    const loopPath = container.get(`${key}.${index}${labeled ? '.body' : ''}`)
    let replacement = null
    if (
      t.isWhileStatement(loop) &&
      t.isBlockStatement(loop.body) &&
      registerWritten(loop.body.body.at(-1)) === register &&
      readsName(loop.test, register) &&
      !continuesLoop(loopPath, labeled ? statement.label.name : null)
    )
      replacement = t.forStatement(
        statements[index - 1].expression,
        loop.test,
        loop.body.body.at(-1).expression,
        t.blockStatement(loop.body.body.slice(0, -1)),
      )
    else if (
      t.isForStatement(loop) &&
      loop.init === null &&
      loop.update &&
      writtenRegisters(loop.update).includes(register)
    )
      replacement = { ...loop, init: statements[index - 1].expression }
    if (!replacement) continue
    if (labeled) statement.body = replacement
    else statements[index] = replacement
    statements.splice(index - 1, 1)
  }
}

// The register an `r = e;` statement writes, or null.
function registerWritten(statement) {
  const expression = statement?.expression
  return t.isExpressionStatement(statement) &&
    t.isAssignmentExpression(expression, { operator: '=' }) &&
    t.isIdentifier(expression.left) &&
    expression.left.name.startsWith('__recovered_r_')
    ? expression.left.name
    : null
}

function writtenRegisters(expression) {
  if (t.isSequenceExpression(expression))
    return expression.expressions.flatMap(writtenRegisters)
  const written = registerWritten(t.expressionStatement(expression))
  return written === null ? [] : [written]
}

function readsName(node, name) {
  let found = false
  t.traverseFast(node, (child) => {
    if (!t.isIdentifier(child, { name })) return undefined
    found = true
    return t.traverseFast.stop
  })
  return found
}

// Whether a `continue` in the loop's body targets the loop: an unlabeled one whose nearest loop is
// this one, or one naming the loop's label; a nested function's are its own.
function continuesLoop(loopPath, label) {
  let found = false
  loopPath.get('body').traverse({
    Function(path) {
      path.skip()
    },
    ContinueStatement(path) {
      const { label: target } = path.node
      if (
        target
          ? target.name === label
          : path.findParent((parent) => parent.isLoop())?.node === loopPath.node
      ) {
        found = true
        path.stop()
      }
    },
  })
  return found
}

function parseEmittedJavaScript(source) {
  try {
    return parse(source, {
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      sourceType: 'script',
    })
  } catch (error) {
    decline(
      'emitted-parse-failed',
      `Fresh parse of VM switch output failed: ${error.message}`,
    )
  }
}
