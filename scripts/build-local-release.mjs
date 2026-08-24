#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const version = packageJson.version;
const releaseDir = join(root, "target", "release", "artifacts", `v${version}`);
const extensionDist = join(root, "apps", "extension", "dist");
const extensionZip = join(releaseDir, `Fragment-Extension-v${version}.zip`);
const nativeProtocolVersion = 2;
const minimumNativeProtocolVersion = 1;
const maxNativeMessageBytes = 1024 * 1024;

if (process.env.FRAGMENT_SKIP_BUILD !== "1") {
  run("pnpm", ["build:extension"]);
  run("pnpm", ["build:desktop"], {
    APPLE_SIGNING_IDENTITY: "-",
    CI: "true",
  });
}

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
if ((statSync(bundledHost).mode & 0o111) === 0) {
  throw new Error(`Bundled native host is not executable at ${bundledHost}`);
}
verifyBundledNativeHost(bundledHost, version);

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

const bundleDmgs = findByExtension(bundleDir, ".dmg");
const intermediateDmgs = bundleDmgs.filter((path) =>
  /^rw\.\d+\.Fragment_.*\.dmg$/.test(basename(path)),
);
for (const path of intermediateDmgs) {
  rmSync(path, { force: true });
}
const finalDmgs = bundleDmgs.filter((path) => !intermediateDmgs.includes(path));
if (finalDmgs.length !== 1) {
  throw new Error(
    `Expected one final DMG, found ${finalDmgs.length}: ${finalDmgs.join(", ")}`,
  );
}

const distributableFiles = [extensionZip, ...finalDmgs];
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
const sourceDirty =
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim().length > 0;
const manifest = {
  product: "Fragment",
  version,
  commit,
  sourceDirty,
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

function verifyBundledNativeHost(hostPath, expectedVersion) {
  const requestId = "fragment-release-packaging";
  const requestBody = Buffer.from(
    JSON.stringify({
      type: "ping",
      requestId,
      protocolVersion: nativeProtocolVersion,
      minimumProtocolVersion: minimumNativeProtocolVersion,
    }),
    "utf8",
  );
  const request = Buffer.allocUnsafe(4 + requestBody.byteLength);
  request.writeUInt32LE(requestBody.byteLength, 0);
  requestBody.copy(request, 4);

  const probeRoot = mkdtempSync(
    join(tmpdir(), "fragment-release-native-host-"),
  );
  let result;
  try {
    result = spawnSync(hostPath, [], {
      cwd: root,
      env: { ...process.env, FRAGMENT_APP_DATA_DIR: probeRoot },
      input: request,
      timeout: 5000,
      maxBuffer: maxNativeMessageBytes + 4,
    });
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }

  if (result.error) {
    throw new Error(
      `Bundled native host probe failed: ${result.error.message}`,
    );
  }
  const stderr = Buffer.isBuffer(result.stderr)
    ? result.stderr.toString("utf8").trim()
    : "";
  if (result.status !== 0) {
    throw new Error(
      `Bundled native host exited unsuccessfully: status=${result.status ?? "null"} signal=${result.signal ?? "null"}${stderr ? `\n${stderr}` : ""}`,
    );
  }

  const output = result.stdout;
  if (!Buffer.isBuffer(output) || output.byteLength < 4) {
    throw new Error("Bundled native host returned no framed response");
  }
  const responseLength = output.readUInt32LE(0);
  if (
    responseLength > maxNativeMessageBytes ||
    output.byteLength !== responseLength + 4
  ) {
    throw new Error("Bundled native host returned an invalid response frame");
  }

  let response;
  try {
    response = JSON.parse(output.subarray(4).toString("utf8"));
  } catch (error) {
    throw new Error(
      `Bundled native host returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const compatibleProtocol =
    response.compatible === true &&
    Number.isSafeInteger(response.protocolVersion) &&
    response.protocolVersion >= minimumNativeProtocolVersion &&
    Number.isSafeInteger(response.minimumProtocolVersion) &&
    response.minimumProtocolVersion <= nativeProtocolVersion;
  if (
    response.type !== "pong" ||
    response.requestId !== requestId ||
    response.ok !== true ||
    response.app !== "Fragment" ||
    response.version !== expectedVersion ||
    !compatibleProtocol
  ) {
    throw new Error(
      `Bundled native host handshake is incompatible: ${JSON.stringify(response)}`,
    );
  }
  console.log(
    `Verified bundled native host v${response.version} protocol ${response.protocolVersion}`,
  );
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
