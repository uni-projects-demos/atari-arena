import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const mode = process.argv[2];

const build = spawnSync(process.execPath, ["engine/tools/build.mjs"], {
  cwd: root,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const args = mode === "dev" ? [] : mode === "pages" ? ["build", "--mode", "pages"] : ["build"];

const r = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", ...args], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_RUNTIME: "browser",
  },
});

if (r.error) {
  throw r.error;
}

process.exit(r.status ?? 1);
