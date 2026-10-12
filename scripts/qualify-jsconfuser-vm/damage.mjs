import { parse } from "../../node_modules/@babel/parser/lib/index.js";
import traverse from "../../node_modules/@babel/traverse/lib/index.js";
import generate from "../../node_modules/@babel/generator/lib/index.js";
import { diagnoseMinifiedClassRuntime } from "../../src/vm/jsconfuser-vm/observe-minified-class-runtime.js";
import { diagnoseMinifiedClassBoot } from "../../src/vm/jsconfuser-vm/observe-minified-class-boot.js";
import { diagnoseContainer } from "../../src/vm/jsconfuser-vm/extract-container.js";
import { diagnoseWordcode } from "../../src/vm/jsconfuser-vm/read-wordcode.js";
import { diagnoseReferences } from "../../src/vm/jsconfuser-vm/validate-references.js";
import { decodeJsconfuserVm } from "../../src/plugin/jsconfuser-vm.js";
import { exactEqual } from "./codec.mjs";

// This module treats damaged runtime/wordcode as source data. No damaged target
// reaches a native observer. Recipes select roles from the pristine graph.
export function damageControls(source) {
  const graph = diagnoseMinifiedClassRuntime(source),
    A = diagnoseContainer(source);
  if (!graph.ok || !A.ok)
    return {
      ok: false,
      diagnostic: !graph.ok ? graph.diagnostic : A.diagnostic,
      controls: [],
    };
  const B = diagnoseWordcode(A.result);
  if (!B.ok) return { ok: false, diagnostic: B.diagnostic, controls: [] };
  const controls = [];
  function control(name, recipe, expected, change, stage = "A") {
    const ast = parse(source),
      functions = [];
    traverse(ast, {
      Function(path) {
        functions.push(path);
      },
    });
    const select = (root, type, predicate = () => true) => {
      let selected;
      const visit = (path) => {
        if (!selected && predicate(path.node)) selected = path;
      };
      if (root === ast) traverse(ast, { [type]: visit });
      else root.traverse({ [type]: visit });
      if (!selected)
        throw new Error(`${name}: ${type} selector did not reach its role`);
      return selected;
    };
    const handler = (opcode) =>
      select(ast, "SwitchCase", (node) => node.test?.value === opcode);
    const owned = (role) => {
      const info = graph.result.functions.find((item) => item.role === role);
      const path = functions.find((path) =>
        info.kind === "method"
          ? path.parentPath.isAssignmentExpression() &&
            path.parentPath.node.left.property.name === info.name
          : path.node.id?.name === info.name,
      );
      if (!path) throw new Error(`${name}: ${role} selection failed`);
      return path;
    };
    const words = () =>
      select(
        ast,
        "ArrayExpression",
        (node) =>
          node.elements.length === graph.result.boot.words.length &&
          node.elements.every(
            (item, i) => item.value === graph.result.boot.words[i],
          ),
      ).node.elements;
    try {
      change({ ast, select, handler, owned, words });
      const damaged = generate(ast).code;
      const boot = diagnoseMinifiedClassBoot(damaged),
        a = diagnoseContainer(damaged);
      const b = a.ok ? diagnoseWordcode(a.result) : null,
        c = b?.ok ? diagnoseReferences(a.result, b.result) : null;
      const diagnostic =
        stage === "A"
          ? a.diagnostic
          : stage === "B"
            ? b?.diagnostic
            : c?.diagnostic;
      const reached =
        stage === "A"
          ? boot.ok && !a.ok
          : stage === "B"
            ? a.ok && !b.ok
            : a.ok && b.ok && !c.ok;
      const publicRecord = decodeJsconfuserVm(damaged);
      const publicCode =
        stage === "A"
          ? "container-declined"
          : stage === "B"
            ? "wordcode-declined"
            : "references-declined";
      const atomic =
        !publicRecord.ok &&
        publicRecord.result === null &&
        publicRecord.output === damaged &&
        publicRecord.diagnostic?.code === publicCode;
      const wrongExpectedRejected = !exactEqual(diagnostic, {
        ...expected,
        message: `${expected.message} intentionally wrong`,
      });
      controls.push({
        name,
        recipe,
        source: damaged,
        stage,
        expected,
        diagnostic,
        reached,
        atomic,
        wrongExpectedRejected,
        ok:
          reached &&
          atomic &&
          wrongExpectedRejected &&
          exactEqual(diagnostic, expected),
        boot,
        A: a,
        B: b,
        C: c,
        publicRecord,
      });
    } catch (error) {
      controls.push({
        name,
        recipe,
        ok: false,
        error: { message: error.message },
      });
    }
  }
  const handlerExpected = (name) => ({
    code: "minified-class-handler",
    message: `${name}: complete handler body or connection changed`,
  });
  const entryExpected = {
    code: "minified-class-entry",
    message: "Complete entry/dispatch/exception/completion effects changed",
  };
  control(
    "add-operator",
    "Selected ADD binary + becomes -",
    handlerExpected("ADD"),
    ({ select, handler }) => {
      select(
        handler(11),
        "BinaryExpression",
        (node) => node.operator === "+",
      ).node.operator = "-";
    },
  );
  control(
    "set-prop-value-list",
    "Selected Reflect.set first two argument slots collapse into one SequenceExpression",
    handlerExpected("SET_PROP"),
    ({ select, handler }) => {
      const call = select(
          handler(9),
          "CallExpression",
          (node) => node.callee.property?.name === "set",
        ).node,
        args = call.arguments;
      call.arguments = [
        { type: "SequenceExpression", expressions: args.slice(0, 2) },
        ...args.slice(2),
      ];
    },
  );
  control(
    "closure-shell-receiver",
    "MAKE_CLOSURE native shell this becomes null",
    handlerExpected("MAKE_CLOSURE"),
    ({ select, handler }) => {
      select(handler(47), "ThisExpression").replaceWith({
        type: "NullLiteral",
      });
    },
  );
  control(
    "catch-slot",
    "Selected runtime catch frame slot5 becomes6",
    entryExpected,
    ({ ast, select }) => {
      select(
        select(ast, "CatchClause"),
        "NumericLiteral",
        (node) => node.value === 5,
      ).node.value = 6;
    },
  );
  control(
    "finally-record-key",
    "FINALLY_SETUP first record key alone changes; catch read stays pristine",
    entryExpected,
    ({ select, handler }) => {
      select(handler(59), "ObjectProperty").node.key.name =
        "changedRecordField";
    },
  );
  control(
    "closure-fixed-prototype",
    "Rename complete Closure descriptor field and all uses to fixed prototype",
    {
      code: "minified-class-ownership",
      message: "Renamed field overlaps fixed semantic member",
    },
    ({ ast }) => {
      const old = graph.result.fields.descriptorField;
      let count = 0;
      traverse(ast, {
        MemberExpression(path) {
          if (!path.node.computed && path.node.property.name === old) {
            path.node.property.name = "prototype";
            count++;
          }
        },
        ObjectProperty(path) {
          if (!path.node.computed && path.node.key.name === old) {
            path.node.key.name = "prototype";
            count++;
          }
        },
      });
      if (!count) throw new Error("Descriptor field mutation did not reach");
    },
  );
  for (const role of ["Upvalue", "closeFrame"])
    control(
      `${role}-extra-effect`,
      `Append opaqueEffect() to selected complete ${role} body`,
      {
        code: "minified-class-functions",
        message: `${role}: complete owned body is missing or changed`,
      },
      ({ owned }) => {
        owned(role).node.body.body.push(
          parse("opaqueEffect()").program.body[0],
        );
      },
    );
  control(
    "unknown-opcode",
    "First word becomes unknown u32 opcode4294967295",
    { code: "unknown-opcode", message: "Unknown opcode 4294967295 at pc 0" },
    ({ words }) => {
      words()[0].value = 0xffffffff;
    },
    "B",
  );
  const terminal = B.result.instructions.at(-1);
  if (terminal.name === "RETURN")
    control(
      "terminal-return-operand",
      "Remove final RETURN operand only",
      {
        code: "truncated-instruction",
        message: `RETURN at ${terminal.pc} is missing a operand`,
      },
      ({ words }) => {
        words().pop();
      },
      "B",
    );
  else
    controls.push({
      name: "terminal-return-operand",
      ok: false,
      unavailable: "No terminal RETURN instruction",
    });
  const branch = B.result.instructions.find((item) =>
    ["JUMP", "JUMP_IF_FALSE", "JUMP_IF_TRUE"].includes(item.name),
  );
  if (branch)
    control(
      "branch-target-operand",
      "Selected immediate branch target becomes its opcode+1 operand boundary",
      {
        code: "invalid-label-reference",
        message: `${branch.name}@${branch.pc} targets non-boundary pc ${branch.pc + 1}`,
      },
      ({ words }) => {
        words()[branch.pc + (branch.name === "JUMP" ? 1 : 2)].value =
          branch.pc + 1;
      },
      "C",
    );
  else
    controls.push({
      name: "branch-target-operand",
      ok: false,
      unavailable: "No immediate branch in this source case",
    });
  return {
    ok: controls.every((item) => item.ok || item.unavailable),
    pristine: { A, B },
    controls,
  };
}
