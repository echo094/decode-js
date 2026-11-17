import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { parse } from "../../../node_modules/@babel/parser/lib/index.js";
import generate from "../../../node_modules/@babel/generator/lib/index.js";
import traverse from "../../../node_modules/@babel/traverse/lib/index.js";
import { makeContext } from "../../../src/vm/jsconfuser-vm/source/container-role-helpers.js";

import { diagnoseRuntimeLayout, runtimeLayout } from "../../../scripts/jsconfuser-vm-cells/layout.mjs"
import { inputPath } from "../../vm/jsconfuser-vm/support/cells.js";

const source = (profile, seed = 172) =>
  fs.readFileSync(inputPath("constant-arithmetic", profile, seed), "utf8");

function setup(profile = "baseline") {
  const ast = parse(source(profile)),
    context = makeContext(ast);
  const call = context
    .nodes(context.program)
    .find(
      ({ node }) =>
        node.type === "CallExpression" &&
        node.arguments.length === 1 &&
        context.bindingFor(node.callee)?.path.node.body?.body[0]?.type ===
          "IfStatement" &&
        context.paths.get(node).parentPath.node.type === "NewExpression",
    ).node;
  const decoder = context.bindingFor(call.callee).path.node;
  return { ast, context, call, decoder };
}
function refusal(change, code, profile = "baseline") {
  const state = setup(profile);
  change(state);
  const encoded = generate(state.ast).code;
  assert.equal(runtimeLayout(encoded), null);
  const result = diagnoseRuntimeLayout(encoded);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, code);
}
test("numeric transport alpha follows the exact decoder/helper/mode/payload bindings", () => {
  const state = setup();
  let count = 0;
  traverse(state.ast, {
    Scopable(path) {
      for (const name of Object.keys(path.scope.bindings))
        path.scope.rename(name, `alpha_${count++}`);
    },
  });
  assert.deepEqual(
    runtimeLayout(generate(state.ast).code),
    runtimeLayout(source("baseline")),
  );
});
test("numeric transport body cannot become arbitrary array pass-through", () =>
  refusal(({ decoder }) => {
    decoder.body.body.splice(1);
  }, "numeric-transport-body"));
test("numeric transport bound mode must remain false", () =>
  refusal(({ context, decoder }) => {
    context.bindingFor(
      decoder.body.body[0].test.argument,
    ).path.node.init.value = true;
  }, "numeric-transport-mode"));
test("numeric transport inlined mode cannot become encoded mode", () =>
  refusal(
    ({ decoder }) => {
      decoder.body.body[0].test.argument.value = true;
    },
    "numeric-transport-body",
    "classObfuscation",
  ));
test("numeric transport decoder cannot be overwritten", () =>
  refusal(({ ast, decoder }) => {
    ast.program.body.unshift(
      ...parse(`${decoder.id.name}=unprovedDecoder;`).program.body,
    );
  }, "numeric-transport-binding"));
test("numeric transport helper body must stay complete", () =>
  refusal(({ context, decoder }) => {
    const helper = context.bindingFor(
      decoder.body.body[1].declarations[0].init.callee,
    ).path.node;
    helper.body.body.push(
      ...parse("globalThis.unprovedEffect();").program.body,
    );
  }, "numeric-transport-helper"));
test("numeric transport payload cannot escape or be mutated through a second reference", () =>
  refusal(({ ast, call }) => {
    assert.equal(call.arguments[0].type, "Identifier");
    ast.program.body.unshift(
      ...parse(`${call.arguments[0].name}[0]=99;`).program.body,
    );
  }, "numeric-transport-payload"));
test("numeric transport argument evaluation cannot contain an extra effect", () =>
  refusal(({ call }) => {
    call.arguments[0] = {
      type: "SequenceExpression",
      expressions: [
        parse("unprovedEffect();").program.body[0].expression,
        call.arguments[0],
      ],
    };
  }, "numeric-transport-payload"));
