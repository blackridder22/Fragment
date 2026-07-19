#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const version = packageJson.version;
const releaseDir = join(root, "target", "release", "artifacts", `v${version}`);
const extensionDist = join(root, "apps", "extension", "dist");
const extensionZip = join(releaseDir, `Fragment-Extension-v${version}.zip`);

run("pnpm", ["build:extension"]);
run("pnpm", ["build:desktop"], { APPLE_SIGNING_IDENTITY: "-" });
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

if (!existsSync(extensionDist)) {
  throw new Error(`Missing extension build at ${extensionDist}`);
}

const extensionFiles = walkFiles(extensionDist)
  .map((path) => relative(extensionDist, path))
  .sort();
if (extensionFiles.length === 0) {
  throw new Error("The packaged extension is empty");
}
execFileSync("/usr/bin/zip", ["-X", "-q", extensionZip, "-@"], {
  cwd: extensionDist,
  input: `${extensionFiles.join("\n")}\n`,
  stdio: ["pipe", "inherit", "inherit"],
});

const bundleDir = join(root, "target", "release", "bundle");
const appPath = join(bundleDir, "macos", "Fragment.app");
const bundledHost = join(appPath, "Contents", "Resources", "fragment-host");
if (!existsSync(appPath)) {
  throw new Error(`Missing app bundle at ${appPath}`);
}
if (!existsSync(bundledHost)) {
  throw new Error(
    `Fragment.app does not contain the native host at ${bundledHost}`,
  );
}

const distributableFiles = [
  extensionZip,
  ...findByExtension(bundleDir, ".dmg"),
];
for (const file of distributableFiles) {
  copyIntoReleaseDirectory(file, releaseDir);
}

const artifacts = readdirSync(releaseDir)
  .map((name) => join(releaseDir, name))
  .filter((path) => statSync(path).isFile())
  .map((path) => ({
    name: relative(releaseDir, path),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));
writeFileSync(
  join(releaseDir, "SHA256SUMS"),
  `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join("\n")}\n`,
);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const manifest = {
  product: "Fragment",
  version,
  commit,
  createdAt: new Date().toISOString(),
  appPath,
  bundledNativeHost: bundledHost,
  artifacts,
};
writeFileSync(
  join(releaseDir, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Fragment v${version} local release: ${releaseDir}`);
console.log(`App bundle: ${appPath}`);
console.log(`Extension ZIP: ${extensionZip}`);

function run(command, args, env = {}) {
  execFileSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function findByExtension(directory, extension) {
  if (!existsSync(directory)) {
    return [];
  }
  return walkFiles(directory).filter((path) => path.endsWith(extension));
}

function copyIntoReleaseDirectory(source, destinationDirectory) {
  const destination = join(destinationDirectory, source.split("/").pop());
  if (resolve(source) !== resolve(destination)) {
    copyFileSync(source, destination);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
