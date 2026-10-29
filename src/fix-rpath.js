import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.platform !== "darwin") process.exit(0);

const dir = "node_modules/tessera.js/dist/prebuilds/darwin-arm64";
const addon = `${dir}/renderer.node`;
if (!existsSync(addon)) process.exit(0);

const rpath = existsSync(`${dir}/libraylib.550.dylib`)
  ? "@loader_path"
  : "/opt/homebrew/lib";

try {
  execSync(`install_name_tool -add_rpath ${rpath} ${addon}`, { stdio: "pipe" });
} catch (e) {
}
execSync(`codesign --force --sign - ${addon}`);
console.log(`tessera.js: patched renderer.node with rpath ${rpath}`);