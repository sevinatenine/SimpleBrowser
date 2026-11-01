#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  await import("./main.js");
} else {
  const { spawn } = await import("node:child_process");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const lib = path.join(here, "..", "vendor", "linux-x64");
  const env = { ...process.env, LD_LIBRARY_PATH: lib + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "") };
  spawn(process.execPath, [path.join(here, "main.js")], { stdio: "inherit", env })
    .on("exit", code => process.exit(code ?? 0));
}