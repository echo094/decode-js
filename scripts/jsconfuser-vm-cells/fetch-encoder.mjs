// Clone the encoder at the cells' PIN into the ignored sandbox-tests/ workspace and
// install its runtime dependencies. The encoder tracks no lockfile, so the versions
// are whatever its ranges resolve to on the day; installedTree is npm's record of
// what was installed, which the cells read. node_modules is ignored there, so the
// checkout stays clean. Set JSCONFUSER_VM_ENCODER instead to encode with an existing
// checkout of the same commit. Git and npm come from PATH.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ENCODER_REPOSITORY, PIN, encoderRoot } from "./audit.mjs";

export const installedTree = path.join(
  encoderRoot,
  "node_modules/.package-lock.json",
);

export function fetchEncoder() {
  if (process.env.JSCONFUSER_VM_ENCODER)
    throw new Error("JSCONFUSER_VM_ENCODER already names an encoder checkout");
  if (fs.existsSync(encoderRoot))
    throw new Error(`${encoderRoot} exists; remove it to fetch again`);
  const run = (command, args, cwd) =>
    execFileSync(command, args, { cwd, stdio: "inherit" });
  run("git", ["clone", "--no-checkout", ENCODER_REPOSITORY, encoderRoot]);
  run("git", ["checkout", "--detach", PIN], encoderRoot);
  run(
    "npm",
    ["install", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund"],
    encoderRoot,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) fetchEncoder();
