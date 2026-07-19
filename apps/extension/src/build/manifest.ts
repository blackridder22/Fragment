export type ExtensionManifest = {
  manifest_version: number;
  name: string;
  version: string;
  [key: string]: unknown;
};

export function packageExtensionManifest(
  canonicalManifest: unknown,
  packageVersion: string,
): string {
  if (!isExtensionManifest(canonicalManifest)) {
    throw new Error("Extension manifest is missing required fields");
  }
  if (canonicalManifest.manifest_version !== 3) {
    throw new Error("Fragment requires a Manifest V3 extension manifest");
  }
  if (canonicalManifest.version !== packageVersion) {
    throw new Error(
      `Extension manifest version ${canonicalManifest.version} does not match package version ${packageVersion}`,
    );
  }

  return `${JSON.stringify(canonicalManifest, null, 2)}\n`;
}

function isExtensionManifest(value: unknown): value is ExtensionManifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.manifest_version === "number" &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string"
  );
}
