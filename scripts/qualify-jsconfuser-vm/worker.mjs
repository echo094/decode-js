import fs from "node:fs";
import { runInNewContext } from "node:vm";
import { performance } from "node:perf_hooks";
import {
  parseRecord,
  tagged,
  stringifyRecord,
} from "./codec.mjs";
import { inspectCurrent } from "./oracles.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { javaRoot, encoderRoot } from "./audit.mjs";
import { generationSession } from "./generation.mjs";

export function observeKnown(source) {
  const context = { TEST_OUTPUT: undefined, performance, atob, btoa };
  context.window = context;
  context.self = context;
  try {
    runInNewContext(source, context, { timeout: 10000 });
    return { kind: "value", value: context.TEST_OUTPUT };
  } catch (error) {
    return {
      kind: error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "timeout" : "error",
      name: error.name,
      message: error.message,
    };
  }
}
async function generate(request) {
  const emit = (event) =>
    fs.appendFileSync(
      request.journalPath,
      JSON.stringify({
        eventAt: new Date().toISOString(),
        value: tagged(event),
      }) + "\n",
    );
  return generationSession(
    { ...request, javaRoot },
    {
      emit,
      loadCompiler: async () =>
        (
          await import(
            pathToFileURL(
              path.join(
                encoderRoot,
                "node_modules/google-closure-compiler/lib/node/index.js",
              ),
            ).href
          )
        ).default,
      loadEncoder: async () =>
        (
          await import(
            pathToFileURL(path.join(encoderRoot, "src/index.ts")).href
          )
        ).JsConfuserVM,
    },
  );
}
if (process.argv[2] === "--worker") {
  try {
    const request = parseRecord(fs.readFileSync(0, "utf8"));
    let result;
    if (request.action === "generate") result = await generate(request);
    else if (request.action === "inspect")
      result = inspectCurrent(request.source);
    else if (request.action === "behavior")
      result = observeKnown(request.source);
    else if (request.action === "patch-inspect")
      result = {
        inspection: inspectCurrent(request.source),
        ...(await import("./patch.mjs")).patchCensusOf(
          request.source,
          request.selfModifying,
        ),
      };
    else throw new Error("Unknown qualification worker action");
    process.stdout.write(stringifyRecord({ ok: true, result }));
  } catch (error) {
    process.stdout.write(
      stringifyRecord({
        ok: false,
        error: {
          name: error.name,
          message: error.message,
          cause: error.cause?.message,
          provenance: error.provenance,
        },
      }),
    );
    process.exitCode = 1;
  }
}
