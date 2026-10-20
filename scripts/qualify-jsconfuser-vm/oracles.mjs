import { parse } from "../../node_modules/@babel/parser/lib/index.js";
import traverse from "../../node_modules/@babel/traverse/lib/index.js";
import generate from "../../node_modules/@babel/generator/lib/index.js";
import * as t from "../../node_modules/@babel/types/lib/index.js";
import { diagnoseContainer } from "../../src/vm/jsconfuser-vm/extract-container.js";
import { diagnoseWordcode } from "../../src/vm/jsconfuser-vm/read-wordcode.js";
import { diagnoseReferences } from "../../src/vm/jsconfuser-vm/validate-references.js";
import { diagnoseStandaloneInput } from "../../src/vm/jsconfuser-vm/diagnose-standalone.js";
import { decodeJsconfuserVm } from "../../src/plugin/jsconfuser-vm.js";
import { exactEqual } from "./codec.mjs";
import { runtimeLayout } from "./layout.mjs";

export const PROJECTION_VERSION = "vm-qualification-normalized.v1";
export const SEMANTIC_LIMITS = {
  EH: "E models CALL/CALL_METHOD/NEW and explicit THROW exceptions; property/coercion exception edges remain incomplete; H projects E routes.",
  F: "Direct callees differ from defective fixed-r2/r3 result provenance; returned closure facts are limited.",
  G: "Static event/fallback labels; method-receiver destination, external-result/NEW precision and inherited F result provenance remain unqualified; imprecise joined arguments can suppress events.",
};
function state(ast) {
  const nodes = new Set(),
    aliases = [];
  const visit = (node) => {
    if (!node?.type) return;
    if (nodes.has(node)) {
      aliases.push(node.type);
      return;
    }
    nodes.add(node);
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(ast);
  const bindings = [],
    detached = [];
  traverse(ast, {
    Scopable(path) {
      for (const name of Object.keys(path.scope.bindings).sort()) {
        const binding = path.scope.bindings[name];
        bindings.push({
          name,
          references: binding.references,
          constant: binding.constant,
          violations: binding.constantViolations.length,
        });
        for (const ref of binding.referencePaths)
          if (!nodes.has(ref.node)) detached.push(name);
      }
    },
  });
  return { bindings, aliases, detached };
}
export function outputChecks(output, input, result) {
  try {
    const ast = parse(output, { sourceType: "script" });
    const first = state(ast),
      second = state(parse(output, { sourceType: "script" }));
    const findings = [];
    const inputAst = parse(input, { sourceType: "script" });
    const admitted = diagnoseContainer(inputAst);
    const sourceRoles = admitted.ok
      ? {
          words: admitted.result.roles.words.values,
          constructors: admitted.result.constructors,
          methods: admitted.result.methods,
        }
      : null;
    const recoveredFunctions = [];
    // A numeric stream read inside a loop-connected switch is a dispatcher,
    // regardless of binding names. An ordinary user switch does not read its
    // discriminant through an advancing stream cursor.
    traverse(ast, {
      FunctionDeclaration(path) {
        if (/^__recovered_function_[0-9]+$/.test(path.node.id?.name))
          recoveredFunctions.push(path.node.id.name);
      },
      ArrayExpression(path) {
        if (
          sourceRoles &&
          exactEqual(
            path.node.elements.map((node) =>
              node?.type === "NumericLiteral" ? node.value : null,
            ),
            sourceRoles.words,
          )
        )
          findings.push("retained-source-wordcode");
      },
      SwitchStatement(path) {
        const selector = path.node.discriminant;
        const loop = path.findParent((parent) => parent.isLoop());
        const advancingStream = (read) => {
          if (read?.type !== "MemberExpression" || !read.computed) return false;
          if (read.property.type === "UpdateExpression") return true;
          const cursor =
            read.property.type === "Identifier" &&
            path.scope.getBinding(read.property.name);
          return Boolean(
            cursor &&
            cursor.constantViolations.some(
              (write) =>
                write.isUpdateExpression() &&
                write.findParent((parent) => parent.node === loop?.node),
            ),
          );
        };
        const selectedBinding =
          selector.type === "Identifier" &&
          path.scope.getBinding(selector.name);
        const selectedReads = selectedBinding
          ? [
              selectedBinding.path.node.init,
              ...selectedBinding.constantViolations.map(
                (write) => write.node.right,
              ),
            ]
          : [];
        if (
          loop &&
          (advancingStream(selector) || selectedReads.some(advancingStream))
        )
          findings.push("numeric-stream-dispatch");
        if (
          selector.type === "Identifier" &&
          path.findParent((parent) => parent.isLoop())
        ) {
          const binding = path.scope.getBinding(selector.name);
          if (
            binding &&
            binding.constantViolations.some(
              (write) =>
                write.findParent((parent) => parent.node === path.node) &&
                write.node.right?.type === "NumericLiteral",
            )
          )
            findings.push("opaque-state-dispatch");
        }
      },
    });
    const forbidden = new Set([
      "BYTECODE",
      "CONSTANTS",
      "ENCODE_BYTECODE",
      "VM",
      "Closure",
      "Upvalue",
      "decodeBytecode",
      "__recovered_pc",
      "__recovered_dispatch",
    ]);
    traverse(ast, {
      Identifier(path) {
        if (forbidden.has(path.node.name)) findings.push(path.node.name);
      },
      CallExpression(path) {
        if (
          path.node.callee.type === "Identifier" &&
          ["eval", "Function"].includes(path.node.callee.name)
        )
          findings.push(path.node.callee.name);
      },
      NewExpression(path) {
        if (
          path.node.callee.type === "Identifier" &&
          path.node.callee.name === "Function"
        )
          findings.push("Function");
      },
    });
    if (runtimeLayout(output)) findings.push("connected-VM-payload");
    const fresh =
      output !== input && generate(ast).code !== generate(inputAst).code;
    const outputIdentity = result?.output === output;
    const summary = result?.simplification?.summary;
    const control = result?.control;
    const recoveredCoverage =
      result?.coverage?.instructions === result?.instructionCount &&
      result?.coverage?.functions === result?.functionCount &&
      summary &&
      summary.emitted + summary.safelyEliminated + summary.provenUnreachable ===
        result.instructionCount &&
      control?.functions?.length === result.functionCount &&
      control?.modeCounts?.stateMachine === 0 &&
      recoveredFunctions.length === result.functionCount;
    const proof = result?.proof;
    const complete =
      result?.packet === "N" &&
      proof?.allPredecessorsReconstructed === true &&
      proof?.freshSimplificationState === true &&
      proof?.simplificationDispositionsDisjoint === true &&
      proof?.finalParseValidated === true &&
      proof?.finalResidueValidated === true;
    const derivedState =
      !first.aliases.length &&
      !first.detached.length &&
      exactEqual(first, second);
    return {
      ok:
        fresh &&
        outputIdentity &&
        recoveredCoverage &&
        complete &&
        derivedState &&
        !findings.length,
      fresh,
      outputIdentity,
      recoveredCoverage: Boolean(recoveredCoverage),
      sourceRoles,
      complete,
      parse: true,
      derivedState,
      stateBoundary: "fresh-output-parse",
      residue: [...new Set(findings)],
    };
  } catch (error) {
    return {
      ok: false,
      parse: false,
      error: { name: error.name, message: error.message },
    };
  }
}
export function inspectCurrent(source, adapter = decodeJsconfuserVm) {
  const ast = parse(source, { sourceType: "script" });
  const before = state(ast),
    serialized = JSON.stringify(ast);
  const A = diagnoseContainer(ast),
    after = state(ast);
  const inputState =
    exactEqual(before, after) &&
    serialized === JSON.stringify(ast) &&
    !after.detached.length &&
    !after.aliases.length;
  const B = A.ok ? diagnoseWordcode(A.result) : null;
  const C = B?.ok ? diagnoseReferences(A.result, B.result) : null;
  const preflight = diagnoseStandaloneInput(source);
  const publicRecord = adapter(source);
  const checks = publicRecord.ok
    ? outputChecks(publicRecord.output, source, publicRecord.result)
    : { ok: false, declined: true };
  const model = preflight.ok ? preflight.model : null;
  const projection = model
    ? {
        version: PROJECTION_VERSION,
        words: model.wordcode.words,
        constants: model.constants,
        root: A.result?.roles.scalars.MAIN_START_PC.value,
        registers: A.result?.roles.scalars.MAIN_REG_COUNT.value,
        frame: A.result
          ? {
              header: A.result.roles.scalars.HEADER_SIZE.value,
              start: A.result.roles.scalars.FRAME_START.value,
              slots: A.result.roles.slots.values,
            }
          : null,
        instructions: model.wordcode.instructions,
        functions: model.functions,
        control: model.structuredControl,
      }
    : null;
  const firstBoundary = !A.ok
    ? { packet: "A", diagnostic: A.diagnostic }
    : B && !B.ok
      ? { packet: "B", diagnostic: B.diagnostic }
      : C && !C.ok
        ? { packet: "C", diagnostic: C.diagnostic }
        : !preflight.ok
          ? {
              packet: preflight.diagnostic.code,
              diagnostic: preflight.diagnostic,
            }
          : !publicRecord.ok
            ? { packet: "N", diagnostic: publicRecord.diagnostic }
            : null;
  return {
    publicRecord,
    A,
    B,
    C,
    analysis: preflight,
    projection,
    checks,
    inputState,
    firstBoundary,
    semanticLimits: SEMANTIC_LIMITS,
  };
}

// Historical output is deliberately absent from the execution request. The
// injected observation seam exists for oracle tests, not production decoding.
export async function assessCurrent(inspected, source, expected, observe) {
  if (!inspected.publicRecord.ok)
    return { qualified: false, status: "declined", behavior: null };
  if (!observe)
    return {
      qualified: false,
      status: "parser-only",
      behavior: { qualified: false },
    };
  const sourceObservation =
      expected.sourceObservation ?? (await observe(source)),
    encodedObservation =
      expected.encodedObservation ?? (await observe(expected.encoded)),
    decodedObservation = await observe(inspected.publicRecord.output);
  const behavior = {
    sourceObservation,
    encodedObservation,
    decodedObservation,
  };
  const values = [sourceObservation, encodedObservation, decodedObservation];
  const equal =
    values.every((record) => record.kind === "value") &&
    exactEqual(sourceObservation, encodedObservation) &&
    exactEqual(sourceObservation, decodedObservation);
  const independent =
    !Object.hasOwn(expected, "value") ||
    exactEqual(sourceObservation.value, expected.value);
  return {
    qualified:
      equal && independent && inspected.checks.ok && inspected.inputState,
    status:
      !equal || !independent
        ? "behavior-mismatch"
        : inspected.checks.ok && inspected.inputState
          ? "accepted"
          : "oracle-failed",
    behavior,
  };
}
