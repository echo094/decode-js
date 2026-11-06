import { parse } from '../../node_modules/@babel/parser/lib/index.js';
import { classLayoutEffect } from "./layout.mjs";
import { profiles } from "./config.mjs";
import { exactEqual as same } from "./codec.mjs";
import { extractContainerFromSource } from "../../src/vm/jsconfuser-vm/extract-container.js";
import { diagnoseSelfModifyingRegions } from "../../src/vm/jsconfuser-vm/observe-self-modifying.js";
const patchEffects = new Map();
function hasProvedPatch(source) {
  if (patchEffects.has(source)) return patchEffects.get(source);
  const container = extractContainerFromSource(source);
  const diagnosed = container ? diagnoseSelfModifyingRegions(container) : null;
  const observed = diagnosed?.ok
    ? true
    : diagnosed?.diagnostic?.code === "no-patch"
      ? false
      : null;
  patchEffects.set(source, observed);
  return observed;
}

// Representation census only: no admission or numeric-role inference. The
// removal control must contain a complete distinct label set too.
function opcodeLabels(source) {
  try {
    const ast = parse(source), sets = [];
    const visit = node => {
      if(!node || typeof node !== 'object') return;
      if(node.type==='SwitchStatement') {
        const labels=node.cases.filter(c=>c.test!==null).map(c=>c.test?.type==='NumericLiteral'?c.test.value:null);
        if(labels.length===61 && labels.every(Number.isSafeInteger) && new Set(labels).size===61) sets.push(labels.sort((a,b)=>a-b));
      }
      if(node.type==='VariableDeclarator' && node.id?.name==='OP' && node.init?.type==='ObjectExpression') {
        const labels=node.init.properties.map(p=>p.value?.type==='NumericLiteral'?p.value.value:null);
        if(labels.length===61 && labels.every(Number.isSafeInteger) && new Set(labels).size===61) sets.push(labels.sort((a,b)=>a-b));
      }
      for(const [key,value]of Object.entries(node)) if(!['loc','start','end','extra'].includes(key)) {
        if(Array.isArray(value))value.forEach(visit);else if(value?.type)visit(value);
      }
    };
    visit(ast); return sets.length===1 ? sets[0] : null;
  } catch { return null; }
}
const randomizationEffect=(left,right)=>{
  const before=opcodeLabels(left),after=opcodeLabels(right);
  return before&&after ? !same(before,after) : null;
};

export function emittedOptionEffect(profile, baseline, candidate, peers) {
  if (profile === "baseline") return { axis: "reference", observed: null };
  if (!baseline || !candidate) return { axis: "uncompared", observed: null };
  const bytecode = (source) =>
    source.match(/^var BYTECODE = ([^\n]+);$/m)?.[1] ??
    source.match(/\bdecodeBytecode\(("[A-Za-z0-9+/=]+")\)/)?.[1] ??
    null;
  const switchCases = (source) =>
    [...source.matchAll(/\bcase OP\.([A-Z_]+):/g)].map((match) => match[1]);
  const handlerKeys = (source) =>
    [...source.matchAll(/VMPrototype\[(OP\.[A-Z_]+|\d+)\]\s*=/g)].map(
      (match) => match[1],
    );
  const minifiedTableKeys = (source) =>
    [
      ...source.matchAll(/\b[A-Za-z_$][\w$]*\[(\d+)\]\s*=\s*function\s*\(/g),
    ].map((match) => Number(match[1]));
  const enabled = Object.keys(profiles[profile]).filter(
    (option) => profiles[profile][option],
  );
  if (enabled.length > 1) {
    const components = Object.fromEntries(
      enabled.map((option) => {
        const counterpartOptions = enabled.filter((item) => item !== option);
        const counterpartName = Object.keys(profiles).find((name) =>
          same(
            Object.keys(profiles[name])
              .filter((key) => profiles[name][key])
              .sort(),
            counterpartOptions.sort(),
          ),
        );
        const counterpart = peers.get(counterpartName);
        if(counterpart && option === "randomizeOpcodes") return [option,randomizationEffect(counterpart,candidate)];
        if (counterpart && option === "minify") {
          return [
            option,
            Buffer.byteLength(candidate) < Buffer.byteLength(counterpart),
          ];
        }
        if (
          counterpart &&
          option === "selfModifying" &&
          enabled.includes("minify")
        ) {
          const candidatePatch = hasProvedPatch(candidate);
          const counterpartPatch = hasProvedPatch(counterpart);
          return [
            option,
            candidatePatch === null || counterpartPatch === null
              ? null
              : candidatePatch && !counterpartPatch,
          ];
        }
        if (
          counterpart &&
          option === "handlerTable" &&
          enabled.includes("minify")
        ) {
          return [
            option,
            minifiedTableKeys(candidate).length >= 61 &&
              minifiedTableKeys(counterpart).length === 0,
          ];
        }
        if (
          counterpart &&
          option === "encodeBytecode" &&
          enabled.includes("minify")
        ) {
          return [
            option,
            candidate.includes("new Uint32Array(") &&
              !counterpart.includes("new Uint32Array("),
          ];
        }
        return [
          option,
          counterpart
            ? option === "classObfuscation"
              ? classLayoutEffect(counterpart, candidate).observed
              : option === "handlerTable"
                ? counterpart.includes("switch (op)") &&
                  !candidate.includes("switch (op)")
                : option === "shuffleOpcodes"
                  ? candidate.includes("switch (op)") &&
                    counterpart.includes("switch (op)")
                    ? switchCases(candidate).length &&
                      switchCases(counterpart).length
                      ? !same(switchCases(candidate), switchCases(counterpart))
                      : null
                    : handlerKeys(candidate).length &&
                        handlerKeys(counterpart).length
                      ? !same(handlerKeys(candidate), handlerKeys(counterpart))
                      : null
                  : bytecode(candidate) && bytecode(counterpart)
                    ? bytecode(candidate) !== bytecode(counterpart)
                    : null
            : null,
        ];
      }),
    );
    return {
      axis: enabled.some((option) =>
        ["shuffleOpcodes", "handlerTable", "classObfuscation"].includes(option),
      )
        ? "emitted-representation-components"
        : "serialized-bytecode-components",
      observed: Object.values(components).includes(false)
        ? false
        : Object.values(components).includes(null)
          ? null
          : true,
      components,
      ...(enabled.includes("classObfuscation")
        ? {
            classWitness: classLayoutEffect(
              peers.get(
                enabled.length === 2 && enabled.includes("minify")
                  ? "minify"
                  : "baseline",
              ) ?? "",
              candidate,
            ),
          }
        : {}),
    };
  }
  let axis;
  let observed;
  if (profile === "shuffleOpcodes") {
    axis = "runtime-opcode-order";
    const left = switchCases(baseline);
    const right = switchCases(candidate);
    observed = left.length && right.length ? !same(left, right) : null;
  } else if (profile === "randomizeOpcodes") {
    axis="source-opcode-label-allocation";
    observed=randomizationEffect(baseline,candidate);
  } else if (profile === "classObfuscation") {
    axis = "runtime-class-layout";
    observed = classLayoutEffect(baseline, candidate).observed;
  } else if (profile === "handlerTable") {
    axis = "runtime-handler-table";
    observed =
      baseline.includes("switch (op)") && !candidate.includes("switch (op)");
  } else if (profile === "timingChecks") {
    axis = "runtime-timing-threshold";
    const left = baseline.match(/^var TIMING_CHECKS = ([^;]+);$/m)?.[1];
    const right = candidate.match(/^var TIMING_CHECKS = ([^;]+);$/m)?.[1];
    observed = left && right ? left === "false" && right !== "false" : null;
  } else if (profile === "minify") {
    axis = "runtime-minification";
    observed = Buffer.byteLength(candidate) < Buffer.byteLength(baseline);
  } else {
    axis = "serialized-bytecode";
    const left = bytecode(baseline);
    const right = bytecode(candidate);
    observed = left && right ? left !== right : null;
  }
  return { axis, observed };
}
