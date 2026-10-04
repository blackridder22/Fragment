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
verifyBundledSvgWorker(bundledHost);

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
const finalDmgs = bundleDmgs.filter(
  (path) =>
    !intermediateDmgs.includes(path) &&
    basename(path).startsWith(`Fragment_${version}_`),
);
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
  appExecutableSha256: sha256(
    join(appPath, "Contents", "MacOS", "fragment-desktop"),
  ),
  bundledNativeHostSha256: sha256(bundledHost),
  privateSvgWorkerVerified: true,
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
    !response.capabilities?.includes("svg") ||
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

function verifyBundledSvgWorker(hostPath) {
  const probe = mkdtempSync(join(tmpdir(), "fragment-release-svg-"));
  try {
    const input = join(probe, "original.svg");
    const original = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#ff8000"/></svg>',
    );
    writeFileSync(input, original);
    const result = spawnSync(hostPath, ["--render-svg"], {
      env: { ...process.env, FRAGMENT_APP_DATA_DIR: join(probe, "no-vault") },
      input: JSON.stringify({ input, output: probe, tiers: [640, 1600] }),
      timeout: 5500,
      maxBuffer: 16384,
    });
    if (result.error || result.status !== 0)
      throw new Error("Bundled SVG worker did not finish");
    const response = JSON.parse(result.stdout.toString("utf8"));
    if (
      !response.result?.Ok ||
      response.result.Ok.width !== 320 ||
      response.result.Ok.height !== 160
    )
      throw new Error("Bundled SVG worker returned invalid dimensions");
    for (const edge of [640, 1600]) {
      const png = readFileSync(join(probe, `${edge}.png`));
      if (
        png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        png.readUInt32BE(16) !== edge ||
        png.readUInt32BE(20) !== edge / 2
      )
        throw new Error("Bundled SVG worker produced invalid PNG");
    }
    if (
      existsSync(join(probe, "no-vault")) ||
      !readFileSync(input).equals(original)
    )
      throw new Error("Private worker touched its original or opened a Vault");
    console.log(
      "Verified private bundled SVG worker, PNG dimensions, unchanged original, and no database initialization",
    );
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
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
