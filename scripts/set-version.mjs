import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm version:set <major.minor.patch>");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const jsonFiles = [
  "package.json",
  "apps/desktop/package.json",
  "apps/extension/package.json",
  "apps/extension/manifest.json",
  "apps/extension/public/manifest.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "packages/shared/package.json"
];
const cargoFiles = [
  "crates/fragment-core/Cargo.toml",
  "crates/fragment-host/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.toml"
];

for (const relativePath of jsonFiles) {
  const path = resolve(root, relativePath);
  const document = JSON.parse(await readFile(path, "utf8"));
  document.version = version;
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
}

for (const relativePath of cargoFiles) {
  const path = resolve(root, relativePath);
  const source = await readFile(path, "utf8");
  const versionPattern = /^(\s*version\s*=\s*)"[^"]+"/m;

  if (!versionPattern.test(source)) {
    throw new Error(`Could not find package version in ${relativePath}`);
  }

  const updated = source.replace(versionPattern, `$1"${version}"`);
  await writeFile(path, updated);
}

console.log(`Fragment version set to ${version}. Run cargo check to refresh Cargo.lock.`);
