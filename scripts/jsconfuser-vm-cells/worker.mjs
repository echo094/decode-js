import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseRecord, stringifyRecord } from "./codec.mjs";
import { javaRoot, encoderRoot } from "./audit.mjs";
import { generationSession } from "./generation.mjs";

// The worker process run-worker.mjs starts: it reads one request record on stdin, encodes the
// request's source with the pinned encoder (generation.mjs) and writes the result record to stdout.
async function generate(request) {
  return generationSession(
    { ...request, javaRoot },
    {
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
    if (request.action !== "generate")
      throw new Error(`Unknown worker action ${request.action}`);
    process.stdout.write(
      stringifyRecord({ ok: true, result: await generate(request) }),
    );
  } catch (error) {
    process.stdout.write(
      stringifyRecord({
        ok: false,
        error: {
          name: error.name,
          message: error.message,
          cause: error.cause?.message,
        },
      }),
    );
    process.exitCode = 1;
  }
}
