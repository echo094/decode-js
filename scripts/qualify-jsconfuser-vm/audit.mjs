import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const decoderRoot = fileURLToPath(new URL("../../", import.meta.url));
// The encoder checkout this decoder is qualified against. JSCONFUSER_VM_ENCODER names
// any checkout of it; otherwise fetch-encoder.mjs clones one into the ignored
// sandbox-tests/ workspace. Either way the snapshot refuses a HEAD other than PIN.
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
const parser = createRequire(path.join(decoderRoot, "package.json"))(
  "@babel/parser",
);
export function manifest(root, censusRoot = root, ancestors = new Set()) {
  const realRoot = fs.realpathSync(root);
  if (ancestors.has(realRoot)) return [];
  const nextAncestors = new Set([...ancestors, realRoot]);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(root, entry.name);
      if (entry.isDirectory())
        return manifest(file, censusRoot, nextAncestors).map((record) => ({
          ...record,
          path: `${entry.name}/${record.path}`,
        }));
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(file),
          resolved = fs.realpathSync(file);
        const relative = path.relative(fs.realpathSync(censusRoot), resolved);
        // pnpm targets within the census are already visited under their real paths.
        const outside =
          relative === ".." ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative);
        const link = {
          path: entry.name,
          kind: "symlink",
          target,
          ...(outside ? { resolved } : { resolvedWithinCensus: relative }),
          sha256: sha256(target),
        };
        if (!outside) return [link];
        if (fs.statSync(file).isDirectory())
          return [
            link,
            ...manifest(file, censusRoot, nextAncestors).map((record) => ({
              ...record,
              path: `${entry.name}/${record.path}`,
            })),
          ];
        const bytes = fs.readFileSync(file);
        return [{ ...link, bytes: bytes.length, contentSha256: sha256(bytes) }];
      }
      if (!entry.isFile()) return [];
      const bytes = fs.readFileSync(file);
      return [{ path: entry.name, bytes: bytes.length, sha256: sha256(bytes) }];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
export function auditEntries(entries, { native = false, external = [] } = {}) {
  const seen = new Set(),
    specifiers = new Set(),
    resolvedImports = [];
  const allowed = new Set([
    "@babel/parser",
    "@babel/traverse",
    "@babel/types",
    "@babel/generator",
    "node:fs",
    "node:crypto",
    "vitest",
    ...external,
  ]);
  const visit = (file) => {
    file = path.resolve(file);
    if (seen.has(file)) return;
    seen.add(file);
    const ast = parser.parse(fs.readFileSync(file, "utf8"), {
      sourceType: "module",
      plugins: file.endsWith(".ts") ? ["typescript"] : [],
    });
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (
        [
          "ImportDeclaration",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
        ].includes(node.type) &&
        node.source
      ) {
        const spec = node.source.value;
        if (spec.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), spec);
          const babel = resolved.match(
            /\/node_modules\/(@babel\/(?:parser|traverse|types|generator))\//,
          )?.[1];
          if (babel) {
            specifiers.add(babel);
            resolvedImports.push({
              importer: path.relative(decoderRoot, file),
              specifier: spec,
              resolved: fs.realpathSync(resolved),
              sha256: sha256(fs.readFileSync(resolved)),
            });
          } else visit(resolved);
        } else {
          specifiers.add(spec);
          if (!allowed.has(spec))
            throw new Error(`Unreviewed import ${spec} in ${file}`);
          if (!spec.startsWith("node:")) {
            const resolved = createRequire(file).resolve(spec);
            if (path.isAbsolute(resolved))
              resolvedImports.push({
                importer: path.relative(decoderRoot, file),
                specifier: spec,
                resolved: fs.realpathSync(resolved),
                sha256: sha256(fs.readFileSync(resolved)),
              });
          }
        }
      }
      if (
        !native &&
        (node.type === "ImportExpression" ||
          (node.type === "CallExpression" && node.callee?.type === "Import"))
      )
        throw new Error(`Dynamic import in parser-only closure ${file}`);
      if (
        !native &&
        ["CallExpression", "NewExpression"].includes(node.type) &&
        node.callee?.type === "Identifier" &&
        [
          "eval",
          "Function",
          "require",
          "runInContext",
          "runInNewContext",
          "exec",
          "execFile",
          "spawn",
          "execSync",
          "execFileSync",
          "spawnSync",
        ].includes(node.callee.name)
      )
        throw new Error(`Execution surface in parser-only closure ${file}`);
      for (const child of Object.values(node))
        if (Array.isArray(child)) child.forEach(walk);
        else if (child && typeof child === "object") walk(child);
    };
    walk(ast);
  };
  entries.forEach(visit);
  return {
    files: [...seen].sort().map((file) => path.relative(decoderRoot, file)),
    external: [...specifiers].sort(),
    resolvedImports,
  };
}
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 1 << 28,
  }).trim();
}
// Git identifies committed bytes, so a tracked tree is named by its commit and
// worktree status. Only uncommitted bytes, which Git does not hold, are digested.
function worktree(root, pathspecs) {
  const status = git(root, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...pathspecs,
  ]);
  if (!status) return { status, uncommittedSha256: null };
  const untracked = git(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...pathspecs,
  ])
    .split("\n")
    .filter(Boolean)
    .sort();
  const delta = crypto.createHash("sha256");
  delta.update(git(root, ["diff", "--binary", "HEAD", "--", ...pathspecs]));
  for (const file of untracked)
    delta.update(`\0${file}\0`).update(fs.readFileSync(path.join(root, file)));
  return { status, uncommittedSha256: delta.digest("hex") };
}
// The qualifier's own files: its scripts and their tests, paths relative to the decoder.
export const toolDirectories = [
  "scripts/qualify-jsconfuser-vm",
  "test/scripts/qualify-jsconfuser-vm",
];
const toolPattern = /^(?:scripts|test\/scripts)\/qualify-jsconfuser-vm\/[^/]+\.(?:mjs|js)$/;
export function toolFiles() {
  return toolDirectories
    .flatMap((directory) =>
      fs
        .readdirSync(path.join(decoderRoot, directory))
        .map((name) => `${directory}/${name}`),
    )
    .filter((file) => toolPattern.test(file))
    .sort();
}
// Qualifier tools changed between a commit and the current worktree.
export function changedTools(commit) {
  const changed = [
    ...git(decoderRoot, [
      "diff",
      "--name-only",
      commit,
      "--",
      ...toolDirectories,
    ]).split("\n"),
    ...git(decoderRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ...toolDirectories,
    ]).split("\n"),
  ];
  return [...new Set(changed.filter((file) => toolPattern.test(file)))].sort();
}
export function snapshot({ generation = false } = {}) {
  const encoderCommit = git(encoderRoot, ["rev-parse", "HEAD"]);
  if (encoderCommit !== PIN) throw new Error("Encoder checkout/pin changed");
  const status = git(encoderRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  if (status) throw new Error("Encoder checkout is not clean");
  const decoder = worktree(decoderRoot, ["src"]);
  const files = toolFiles();
  const commit = git(decoderRoot, ["rev-parse", "HEAD"]);
  const result = {
    encoderCommit,
    encoderWorktreeStatus: status,
    // The qualifier shares the decoder's repository, so a commit to it moves the
    // decoder commit; the src tree is what identifies the decoder under test.
    decoderCommit: commit,
    decoderSourceTree: git(decoderRoot, ["rev-parse", "HEAD:src"]),
    decoderWorktreeStatus: decoder.status,
    decoderUncommittedSha256: decoder.uncommittedSha256,
    tools: {
      commit,
      files,
      ...worktree(decoderRoot, files),
    },
    node: {
      version: process.version,
      executable: path.basename(process.execPath),
      sha256: sha256(fs.readFileSync(process.execPath)),
    },
    host: { platform: process.platform, architecture: process.arch },
    decoderDependencies: manifest(path.join(decoderRoot, "node_modules")),
  };
  if (generation) {
    result.encoderDependencies = manifest(
      path.join(encoderRoot, "node_modules"),
    );
    if (!javaRoot)
      throw new Error("Generation needs JAVA_HOME or java on PATH");
    result.java = {
      executable: "java",
      sha256: sha256(fs.readFileSync(path.join(javaRoot, "bin/java"))),
      release: fs.readFileSync(path.join(javaRoot, "release"), "utf8"),
    };
    result.jar = {
      sha256: sha256(
        fs.readFileSync(
          path.join(
            encoderRoot,
            "node_modules/google-closure-compiler-java/compiler.jar",
          ),
        ),
      ),
    };
  }
  return result;
}
