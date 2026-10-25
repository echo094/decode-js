import { parse } from "../../node_modules/@babel/parser/lib/index.js";
import {
  makeContext,
  isWordArray,
  numberValue,
  propertyName,
  referenceCount,
  topLevelDeclarations,
} from "../../src/vm/jsconfuser-vm/container-role-helpers.js";
import {
  BASE64_SHA256,
  runtimeSignature,
} from "../../src/vm/jsconfuser-vm/runtime-source-signature.js";
import { exactEqual } from "./codec.mjs";

// The literal values of a constant-pool array, with minify's `!0`, `!1` and `void 0` spellings;
// null when an element is not a literal.
function poolValues(node, context) {
  if (node?.type !== "ArrayExpression") return null;
  const values = [];
  for (const element of node.elements) {
    if (
      element?.type === "StringLiteral" ||
      element?.type === "NumericLiteral" ||
      element?.type === "BooleanLiteral"
    )
      values.push(element.value);
    else if (element?.type === "NullLiteral") values.push(null);
    else if (
      element?.type === "UnaryExpression" &&
      element.operator === "!" &&
      (numberValue(element.argument) === 0 ||
        numberValue(element.argument) === 1)
    )
      values.push(numberValue(element.argument) === 0);
    else if (
      (element?.type === "Identifier" &&
        element.name === "undefined" &&
        !context.bindingFor(element)) ||
      (element?.type === "UnaryExpression" &&
        element.operator === "void" &&
        numberValue(element.argument) === 0)
    )
      values.push(undefined);
    else return null;
  }
  return values;
}

const NUMERIC_TRANSPORT_SIGNATURES = new Set([
  "5e639974414e47e7fb566a6ae57cd56b9a6329a776218898b5976f91d01cb19c",
  "61933608ccc41584c75e9d3462d41856959327805f6ee981229e9bf6beb8fdd4",
]);
class LayoutDecline extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const transportCheck = (condition, code, message) => {
  if (!condition) throw new LayoutDecline(code, message);
};
function numericTransport(context, call, resolve) {
  transportCheck(
    call?.type === "CallExpression" && call.arguments.length === 1,
    "numeric-transport-call",
    "Numeric transport requires one exact payload argument",
  );
  const binding = context.bindingFor(call.callee),
    fn = binding?.path.node;
  transportCheck(
    binding?.constant &&
      fn?.type === "FunctionDeclaration" &&
      context.paths.get(fn).parentPath.isProgram() &&
      referenceCount(context, binding) === 1,
    "numeric-transport-binding",
    "Numeric transport decoder must be stable, top-level and used once",
  );
  transportCheck(
    NUMERIC_TRANSPORT_SIGNATURES.has(
      runtimeSignature({ params: fn.params, body: fn.body }, context),
    ),
    "numeric-transport-body",
    "Numeric transport body differs from the pinned complete decoder",
  );
  const mode = fn.body.body[0].test.argument;
  if (mode.type === "Identifier") {
    const flag = context.bindingFor(mode);
    transportCheck(
      flag?.constant &&
        context.paths.get(flag.path.node).parentPath.parentPath.isProgram() &&
        flag.path.node.init?.type === "BooleanLiteral" &&
        flag.path.node.init.value === false &&
        referenceCount(context, flag) === 1,
      "numeric-transport-mode",
      "Numeric transport mode must be the stable disabled binding",
    );
  } else
    transportCheck(
      mode.type === "BooleanLiteral" && mode.value === false,
      "numeric-transport-mode",
      "Numeric transport mode must be the disabled literal",
    );
  const declarations = topLevelDeclarations(context);
  const bytes = fn.body.body[1]?.declarations?.[0]?.init;
  const helper = context.bindingFor(bytes?.callee);
  transportCheck(
    helper?.constant &&
      declarations.some(
        (entry) => entry.binding === helper && entry.kind === "function",
      ) &&
      runtimeSignature(helper.path.node, context) === BASE64_SHA256 &&
      context.sameRef(bytes.arguments[0], context.bindingFor(fn.params[0])),
    "numeric-transport-helper",
    "Numeric transport byte helper/body/parameter connection changed",
  );
  const payload = resolve(call.arguments[0], false);
  const payloadBinding = context.bindingFor(call.arguments[0]);
  transportCheck(
    isWordArray(payload) &&
      (!payloadBinding || referenceCount(context, payloadBinding) === 1),
    "numeric-transport-payload",
    "Numeric transport payload must be a stable numeric word array used only by the decoder call",
  );
  return payload;
}

// Observe emitted layout independently of public admission. Payload constructor
// binding and receiver-connected optional slot writes anchor the census.
function observeRuntimeLayout(source) {
  try {
    const context = makeContext(parse(source, { sourceType: "script" }));
    const resolve = (node, transport = true) => {
      if (node?.type === "Identifier") {
        const binding = context.bindingFor(node);
        if (
          !binding?.constant ||
          !context.paths
            .get(binding.path.node)
            .parentPath.parentPath.isProgram()
        )
          return null;
        node = binding.path.node.init;
      }
      return transport && node?.type === "CallExpression"
        ? numericTransport(context, node, resolve)
        : node;
    };
    const candidates = context
      .nodes(context.program)
      .filter(({ node }) => node.type === "NewExpression")
      .map(({ node }) => {
        const fn = context.bindingFor(node.callee)?.path.node;
        if (fn?.type !== "FunctionDeclaration") return null;
        const args = node.arguments.map((argument) => resolve(argument));
        const words = args.findIndex((arg) => isWordArray(arg));
        const pool = args.findIndex((arg) =>
          poolValues(arg, context)?.some((value) => typeof value === "string"),
        );
        if (words < 0 || pool < 0 || words === pool) return null;
        const assignments = context
          .nodes(fn)
          .map(({ node }) => node)
          .filter(
            (node) =>
              node.type === "AssignmentExpression" &&
              node.operator === "=" &&
              node.left.type === "MemberExpression" &&
              !node.left.computed &&
              node.left.object.type === "ThisExpression",
          );
        const fieldAt = (position) =>
          assignments
            .filter((item) =>
              context.sameRef(
                item.right,
                context.bindingFor(fn.params[position]),
              ),
            )
            .map((item) => propertyName(item.left.property));
        const wordFields = fieldAt(words),
          poolFields = fieldAt(pool);
        const regFields = assignments
          .filter(
            (item) =>
              item.right.type === "ArrayExpression" &&
              !item.right.elements.length,
          )
          .map((item) => propertyName(item.left.property));
        if (
          wordFields.length !== 1 ||
          poolFields.length !== 1 ||
          regFields.length !== 1
        )
          return null;
        return {
          node,
          constructor: context.bindingFor(node.callee),
          words,
          pool,
          wordField: wordFields[0],
          regField: regFields[0],
          args: args.length,
        };
      })
      .filter(Boolean);
    if (candidates.length !== 1) return null;
    const vm = candidates[0];
    const functions = context
      .nodes(context.program)
      .filter(({ node }) =>
        ["FunctionDeclaration", "FunctionExpression"].includes(node.type),
      );
    const entryPath = context.paths.get(vm.node);
    const holder = entryPath.parentPath.node;
    const instance = context.bindingFor(
      holder.type === "VariableDeclarator"
        ? holder.id
        : holder.type === "AssignmentExpression"
          ? holder.left
          : null,
    );
    const actualVm = (node) =>
      node === vm.node || (instance && context.sameRef(node, instance));
    const receiverMatches = (node, receiver) =>
      receiver === "this"
        ? node?.type === "ThisExpression"
        : context.sameRef(node, receiver);
    const calleeFunction = (call) => {
      if (call.callee.type === "Identifier") {
        const binding = context.bindingFor(call.callee);
        return functions.find(({ node }) => node === binding?.path.node)?.node;
      }
      if (call.callee.type !== "MemberExpression" || call.callee.computed)
        return null;
      return functions.find(({ path }) => {
        const left = path.parentPath.node.left;
        return (
          left?.type === "MemberExpression" &&
          !left.computed &&
          propertyName(left.property) === propertyName(call.callee.property) &&
          left.object?.type === "MemberExpression" &&
          propertyName(left.object.property) === "prototype" &&
          context.sameRef(left.object.object, vm.constructor)
        );
      })?.node;
    };
    const roots = context
      .nodes(context.program)
      .filter(({ node }) => node.type === "CallExpression")
      .map(({ node }) => {
        const index = node.arguments.findIndex(actualVm),
          method =
            node.callee.type === "MemberExpression" &&
            actualVm(node.callee.object);
        const fn = index >= 0 || method ? calleeFunction(node) : null;
        return fn
          ? {
              node: fn,
              receiver: method ? "this" : context.bindingFor(fn.params[index]),
            }
          : null;
      })
      .filter(Boolean)
      .filter(({ node, receiver }) =>
        context
          .nodes(node)
          .some(
            ({ node }) =>
              node.type === "MemberExpression" &&
              !node.computed &&
              propertyName(node.property) === vm.wordField &&
              receiverMatches(node.object, receiver),
          ),
      );
    if (roots.length !== 1) return null;
    const connected = [...roots];
    for (const entry of connected)
      for (const { node, path } of context.nodes(entry.node)) {
        if (
          node.type !== "CallExpression" ||
          path.getFunctionParent()?.node !== entry.node
        )
          continue;
        const index = node.arguments.findIndex((arg) =>
          receiverMatches(arg, entry.receiver),
        );
        const method =
          node.callee.type === "MemberExpression" &&
          receiverMatches(node.callee.object, entry.receiver);
        const fn = index >= 0 || method ? calleeFunction(node) : null;
        if (fn && !connected.some((entry) => entry.node === fn))
          connected.push({
            node: fn,
            receiver: method ? "this" : context.bindingFor(fn.params[index]),
          });
      }
    const guardKeys = [];
    for (const { node: fn, receiver } of connected)
      for (const { node, path } of context.nodes(fn)) {
        if (path.getFunctionParent()?.node !== fn) continue;
        if (node.type !== "LogicalExpression" || node.operator !== "&&")
          continue;
        const test = node.left;
        if (
          test.type !== "BinaryExpression" ||
          test.operator !== "===" ||
          test.right.type !== "StringLiteral" ||
          test.right.value !== "number" ||
          test.left.type !== "UnaryExpression" ||
          test.left.operator !== "typeof"
        )
          continue;
        const member = test.left.argument;
        if (member.type !== "MemberExpression" || member.computed) continue;
        const binding = context.bindingFor(member.object),
          object = binding?.path.node.init;
        const key = propertyName(member.property);
        if (
          !binding?.constant ||
          object?.type !== "ObjectExpression" ||
          object.properties.some((item) => propertyName(item.key) === key)
        )
          continue;
        // The guarded update must use a register array derived from this VM's
        // register field in the same function, not a similarly named other array.
        const registers = context
          .nodes(fn)
          .map(({ node }) => node)
          .filter((item) =>
            ["AssignmentExpression", "VariableDeclarator"].includes(item.type),
          )
          .filter((item) => {
            const rhs = item.right ?? item.init;
            return (
              rhs?.type === "MemberExpression" &&
              !rhs.computed &&
              propertyName(rhs.property) === vm.regField &&
              receiverMatches(rhs.object, receiver)
            );
          })
          .map((item) => context.bindingFor(item.left ?? item.id))
          .filter(Boolean);
        if (
          !context
            .nodes(node.right)
            .some(
              ({ node: item }) =>
                item.type === "MemberExpression" &&
                item.computed &&
                registers.some((reg) => context.sameRef(item.object, reg)),
            )
        )
          continue;
        guardKeys.push(key);
      }
    return {
      words: vm.words,
      pool: vm.pool,
      argumentCount: vm.args,
      optionalSlotGuards: guardKeys.length,
    };
  } catch (error) {
    if (error instanceof LayoutDecline) throw error;
    return null;
  }
}

export function diagnoseRuntimeLayout(source) {
  try {
    const result = observeRuntimeLayout(source);
    return result
      ? { ok: true, result, diagnostic: null }
      : {
          ok: false,
          result: null,
          diagnostic: {
            code: "unconnected-layout",
            message: "No unique binding-connected runtime layout",
          },
        };
  } catch (error) {
    if (!(error instanceof LayoutDecline)) throw error;
    return {
      ok: false,
      result: null,
      diagnostic: { code: error.code, message: error.message },
    };
  }
}
export function runtimeLayout(source) {
  return diagnoseRuntimeLayout(source).result;
}

export function classLayoutEffect(control, candidate) {
  const left = runtimeLayout(control),
    right = runtimeLayout(candidate);
  if (!left || !right)
    return {
      observed: null,
      witness: "unconnected-layout",
      control: left,
      candidate: right,
    };
  const erased = left.optionalSlotGuards > 0 && right.optionalSlotGuards === 0;
  const permuted =
    left.words !== right.words ||
    left.pool !== right.pool ||
    left.argumentCount !== right.argumentCount;
  return {
    observed:
      erased || permuted ? true : exactEqual(left, right) ? false : null,
    witness: erased
      ? "connected-optional-slots-erased"
      : permuted
        ? "payload-role-permutation"
        : "no-observed-class-witness",
    control: left,
    candidate: right,
  };
}
