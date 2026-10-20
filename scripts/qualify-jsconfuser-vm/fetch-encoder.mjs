// Clone the encoder at the qualifier's PIN into the ignored sandbox-tests/
// workspace and install its runtime dependencies. Set JSCONFUSER_VM_ENCODER instead
// to qualify against an existing checkout of the same commit. Git and npm come
// from PATH.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { ENCODER_REPOSITORY, PIN, encoderRoot } from "./audit.mjs";

if (process.env.JSCONFUSER_VM_ENCODER)
  throw new Error("JSCONFUSER_VM_ENCODER already names an encoder checkout");
if (fs.existsSync(encoderRoot))
  throw new Error(`${encoderRoot} exists; remove it to fetch again`);
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });
run("git", ["clone", "--no-checkout", ENCODER_REPOSITORY, encoderRoot]);
run("git", ["checkout", "--detach", PIN], encoderRoot);
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], encoderRoot);
