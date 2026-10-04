import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Frame = collection, Fragment = saved image, Vault = library. These phrases
 * describe images as Frames or collections as Fragments and must not return.
 */
const INVERTED_PHRASES: Array<[string, RegExp]> = [
  ["New Fragment (a Frame is created, not a Fragment)", /\bNew Fragment\b/],
  ["New nested Fragment", /\bNew nested Fragment\b/],
  ["Rename Fragment", /\bRename Fragment\b/],
  ["Renamed Fragment", /\bRenamed Fragment\b/],
  ["Create a folder for Frames", /Create a folder for Frames/],
  ["Import Frames", /\bImport Frames\b/],
  ["No Frames in your Vault yet", /No Frames in your Vault/],
  ["No Frames yet", /\bNo Frames yet\b/],
  ["Untitled Frame (images are Fragments)", /\bUntitled Frame\b/],
  ["Frames from across your Vault", /Frames from across your Vault/],
  ["Selected n Frames", /Selected (?:\d+|\$\{[^}]*\}) Frames?\b/],
  ["Importing n Frames", /Importing (?:\d+|\$\{[^}]*\}) Frames?\b/],
  ["{n} Frames image count", /\$\{[^}]*\} Frames\b/],
  ["Smart Fragment", /\bSmart Fragment\b/],
  ["protected Fragment", /\bprotected Fragment\b/],
  ["Move to Fragment", /\bMove to Fragment\b/],
  ["Add to Fragment", /\bAdd to Fragment\b/],
  ["Destination Fragment", /\bDestination Fragment\b/],
  ["All Frames filter pill", /\bAll Frames\b/],
  ["Frame selection actions", /\bFrame selection\b/],
  ["Previous / next Frame", /\b(?:Previous|Next) Frame\b/],
  ["Edit Frame title", /\bEdit Frame title\b/],
  [
    "Fragment label on the Frame picker",
    /htmlFor="v7-frame-fragment">\s*Fragment\s*</,
  ],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("product vocabulary", () => {
  const root = new URL(".", import.meta.url).pathname;
  const files = sourceFiles(root);

  it("scans the desktop sources", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const [label, pattern] of INVERTED_PHRASES) {
    it(`never says "${label}"`, () => {
      const offenders = files
        .filter((file) => pattern.test(readFileSync(file, "utf8")))
        .map((file) => relative(root, file));
      expect(offenders).toEqual([]);
    });
  }

  it("labels the image list All Fragments and the tree Frames in the shell", () => {
    const shell = readFileSync(join(root, "v7/DesktopShell.tsx"), "utf8");
    expect(shell).toContain('label="All Fragments"');
    expect(shell).toContain("<span>Frames</span>");
    expect(shell).toContain("<strong>New Frame</strong>");
    expect(shell).toContain("<strong>Import Fragments</strong>");
  });

  it("never uses platform-specific words in product copy", () => {
    const offenders = files
      .filter((file) =>
        /\b(Repin|Pinterest board|Pinterest downloader)\b/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
