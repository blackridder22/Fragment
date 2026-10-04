import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packageExtensionManifest } from "./manifest";

const extensionRoot = new URL("../../", import.meta.url);

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(new URL(relativePath, extensionRoot), "utf8"),
  ) as unknown;
}

describe("extension manifest packaging", () => {
  it("emits the canonical Fragment manifest at the workspace version", () => {
    const canonical = readJson("manifest.json") as Record<string, unknown>;
    const packageMetadata = readJson("package.json") as {
      version: string;
    };

    const packaged = JSON.parse(
      packageExtensionManifest(canonical, packageMetadata.version),
    ) as Record<string, unknown>;

    expect(packaged).toEqual(canonical);
    expect(packaged.name).toBe("Fragment");
    const workspace = readJson("../../package.json") as { version: string };
    expect(packaged.version).toBe(workspace.version);
  });

  it("rejects version drift before packaging", () => {
    expect(() =>
      packageExtensionManifest(
        { manifest_version: 3, name: "Fragment", version: "0.0.4" },
        "0.0.7",
      ),
    ).toThrow(/does not match package version/);
  });
});
