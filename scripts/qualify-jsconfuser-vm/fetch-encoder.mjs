// Clone the encoder at the qualifier's PIN into the ignored sandbox-tests/
// workspace and install its dependencies from encoder-lock.json with `npm ci`, so
// every clone resolves the same versions; the encoder tracks no lockfile of its own
// and ignores package-lock.json, so the copy leaves the checkout clean. Set
// JSCONFUSER_VM_ENCODER instead to qualify against an existing checkout of the same
// commit. Git and npm come from PATH.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ENCODER_REPOSITORY, PIN, encoderRoot } from "./audit.mjs";

export const encoderLock = fileURLToPath(
  new URL("./encoder-lock.json", import.meta.url),
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
  fs.copyFileSync(encoderLock, path.join(encoderRoot, "package-lock.json"));
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], encoderRoot);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) fetchEncoder();
