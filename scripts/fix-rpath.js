import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const here = path.dirname(fileURLToPath(import.meta.url));
const rel = path.join("tessera.js", "dist", "prebuilds", `darwin-${process.arch}`);

// nested install (or running from the repo), then hoisted install
const dir = [
  path.join(here, "..", "node_modules", rel),
  path.join(here, "..", "..", rel),
].find(d => existsSync(path.join(d, "renderer.node")));

if (!dir) {
  console.warn("fix-rpath: tessera.js renderer.node not found, skipping");
  process.exit(0);
}

const addon = path.join(dir, "renderer.node");

const LIB = "libraylib.550.dylib";
const vendorLib = path.join(here, "..", "vendor", `darwin-${process.arch}`, LIB);

if (existsSync(vendorLib)) {
  copyFileSync(vendorLib, path.join(dir, LIB));
  try {
    execFileSync("codesign", ["--force", "--sign", "-", path.join(dir, LIB)], { stdio: "pipe" });
  } catch (e) {
    console.warn("fix-rpath: codesign of dylib failed:", e.message);
  }
}

const rpath = existsSync(path.join(dir, LIB)) ? "@loader_path" : "/opt/homebrew/lib";

try {
  execFileSync("install_name_tool", ["-add_rpath", rpath, addon], { stdio: "pipe" });
} catch {
  // already has this rpath, which is fine
}

try {
  execFileSync("codesign", ["--force", "--sign", "-", addon], { stdio: "pipe" });
  console.log(`tessera.js: patched renderer.node with rpath ${rpath}`);
} catch (e) {
  console.warn("fix-rpath: codesign failed:", e.message);
}