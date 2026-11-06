import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const engine = join(root, "engine");
const out = join(root, "public/runtime");
const gen = join(engine, "browser/src/generated");
const pkg = join(engine, "browser/src/wasm");
const manifestPath = join(engine, "Cargo.toml");

function run(cmd, args, env = {}) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });

  if (res.error) {
    throw res.error;
  }

  if (res.status !== 0) {
    throw new Error(`${cmd} exited with ${res.status}`);
  }
}

await mkdir(out, { recursive: true });

run("cargo", ["test", "--locked", "--manifest-path", manifestPath, "-p", "arena-core"], {
  TS_RS_EXPORT_DIR: gen,
});

const types = (await readdir(gen))
  .filter((name) => name.endsWith(".ts") && name !== "index.ts")
  .sort();

await writeFile(
  join(gen, "index.ts"),
  `${types
    .map((name) => `export type { ${name.slice(0, -3)} } from "./${name.slice(0, -3)}";`)
    .join("\n")}\n`,
);

run("cargo", [
  "run",
  "--quiet",
  "--locked",
  "--manifest-path",
  manifestPath,
  "-p",
  "arena-core",
  "--bin",
  "manifest",
  "--",
  join(engine, "assets/games.json"),
  join(out, "games.json"),
]);

run("cargo", [
  "build",
  "--locked",
  "--manifest-path",
  manifestPath,
  "--release",
  "--target",
  "wasm32-unknown-unknown",
  "-p",
  "arena-wasm",
]);

const meta = spawnSync(
  "cargo",
  ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifestPath],
  {
    cwd: root,
    encoding: "utf8",
  },
);

if (meta.error) {
  throw meta.error;
}

if (meta.status !== 0) {
  throw new Error(meta.stderr);
}

const target = JSON.parse(meta.stdout).target_directory;

run("wasm-bindgen", [
  join(target, "wasm32-unknown-unknown/release/arena_wasm.wasm"),
  "--target",
  "web",
  "--out-dir",
  pkg,
]);

for (const name of ["arena_wasm.js", "arena_wasm_bg.wasm"]) {
  await cp(join(pkg, name), join(out, name));
}

const ale = join(root, "node_modules/@farama/ale-wasm");

await mkdir(join(out, "vendor/ale"), { recursive: true });

const js = await readFile(join(ale, "ale.js"), "utf8");

await writeFile(join(out, "vendor/ale/ale.js"), `${js}\nexport default createALEModule;\n`);

for (const name of ["ale.wasm", "ale.data", "LICENSE"]) {
  await cp(join(ale, name), join(out, "vendor/ale", name));
}

await mkdir(join(out, "roms"), { recursive: true });

const data = await readFile(join(ale, "ale.data"));
const manifest = JSON.parse(await readFile(join(out, "games.json"), "utf8"));

for (const game of manifest.games) {
  const name = game.rom_url.split("/").at(-1);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const entry = js.match(new RegExp(`filename:"/roms/${escaped}",start:(\\d+),end:(\\d+)`));

  if (entry) {
    await writeFile(join(out, "roms", name), data.subarray(Number(entry[1]), Number(entry[2])));
  }
}

const src = JSON.parse(await readFile(join(engine, "assets/games.json"), "utf8"));

const mods =
  typeof src.games[0] === "string"
    ? src.games.map((path) => dirname(resolve(engine, "assets", path)))
    : [join(engine, "assets")];

const copied = new Set();

await rm(join(out, "models"), {
  recursive: true,
  force: true,
});

async function copyAssets(src, dest, modelDir = false) {
  let entries;

  try {
    entries = await readdir(src, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") {
      return;
    }

    throw err;
  }

  await mkdir(dest, { recursive: true });

  for (const entry of entries) {
    if (modelDir && entry.name === "SOURCES.json") {
      continue;
    }

    if (modelDir && entry.isFile() && !/\.(json|md|txt)$/i.test(entry.name)) {
      continue;
    }

    const from = join(src, entry.name);
    const to = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyAssets(from, to, modelDir);
    } else {
      if (copied.has(to)) {
        throw new Error(`Duplicate game asset destination: ${to}`);
      }

      copied.add(to);
      await cp(from, to);
    }
  }
}

const srcs = Object.create(null);

for (const mod of mods) {
  await copyAssets(join(mod, "models"), join(out, "models"), true);

  await copyAssets(join(mod, "roms"), join(out, "roms"));

  let provenance;

  try {
    provenance = JSON.parse(await readFile(join(mod, "models/SOURCES.json"), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      continue;
    }

    throw err;
  }

  for (const [name, val] of Object.entries(provenance)) {
    const key = `${basename(mod)}/${name}`;

    if (Object.hasOwn(srcs, key)) {
      throw new Error(`Duplicate model provenance: ${key}`);
    }

    srcs[key] = val;
  }
}

await mkdir(join(out, "models"), { recursive: true });

await writeFile(join(out, "models/SOURCES.json"), `${JSON.stringify(srcs, null, 2)}\n`);

await cp(join(engine, "multiplayer/vendor/multi-ale"), join(out, "vendor/multi-ale"), {
  recursive: true,
});

const ort = join(root, "node_modules/onnxruntime-web/dist");

await mkdir(join(out, "ort"), { recursive: true });

for (const name of [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
]) {
  await cp(join(ort, name), join(out, "ort", name));
}

console.log("Built browser runtime assets in public/runtime");
