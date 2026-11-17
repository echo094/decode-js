import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const decoderRoot = fileURLToPath(new URL("../../", import.meta.url));
// The encoder checkout the generated cells are encoded with. JSCONFUSER_VM_ENCODER names
// any checkout of it; otherwise fetch-encoder.mjs clones one into the ignored
// sandbox-tests/ workspace. The cell suites refuse a HEAD other than PIN.
export const encoderRoot = process.env.JSCONFUSER_VM_ENCODER
  ? path.resolve(process.env.JSCONFUSER_VM_ENCODER)
  : path.join(decoderRoot, "sandbox-tests/js-confuser-vm");
export const ENCODER_REPOSITORY = "https://github.com/MichaelXF/js-confuser-vm.git";
// The JDK comes from JAVA_HOME, else from the first `java` on PATH that resolves
// into a JDK (one with a release file; launcher stubs do not). Null when none
// does, which only generation needs.
function findJavaRoot() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, "java");
    if (!directory || !fs.existsSync(candidate)) continue;
    const root = path.dirname(path.dirname(fs.realpathSync(candidate)));
    if (fs.existsSync(path.join(root, "release"))) return root;
  }
  return null;
}
export const javaRoot = findJavaRoot();
export const PIN = "20c5b96bf57337c568579352758d7685358650de";
export const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

