import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createVaultFixture,
  FIXTURE_SCHEMA_VERSION,
  FIXTURE_SEED,
  FIXTURE_SIZES,
  fixtureDigest,
  serializeVaultFixture,
} from "./vault-fixture-lib.mjs";

function parseOutputDirectory(argv) {
  const outputFlag = argv.indexOf("--output");
  if (outputFlag === -1) {
    return path.resolve("output/benchmarks/vault-fixtures");
  }
  const output = argv[outputFlag + 1];
  if (!output || output.startsWith("--")) {
    throw new Error("--output requires a directory");
  }
  return path.resolve(output);
}

async function writeAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, filePath);
}

const outputDirectory = parseOutputDirectory(process.argv.slice(2));
await mkdir(outputDirectory, { recursive: true });

const files = [];
for (const size of FIXTURE_SIZES) {
  const fixture = createVaultFixture(size);
  const serialized = serializeVaultFixture(fixture);
  const name = `vault-${size}.json`;
  await writeAtomic(path.join(outputDirectory, name), serialized);
  files.push({
    name,
    size,
    bytes: Buffer.byteLength(serialized),
    sha256: fixtureDigest(serialized),
    counts: fixture.counts,
  });
}

const manifest = `${JSON.stringify(
  {
    fixture: true,
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    seed: FIXTURE_SEED,
    generatedAt: "2026-01-01T00:00:00.000Z",
    files,
  },
  null,
  2,
)}\n`;
await writeAtomic(path.join(outputDirectory, "manifest.json"), manifest);

console.log(`Generated deterministic Vault fixtures in ${outputDirectory}`);
for (const file of files) {
  console.log(`${file.name}\t${file.sha256}\t${file.bytes} bytes`);
}
