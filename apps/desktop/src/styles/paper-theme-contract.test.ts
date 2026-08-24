import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync(
  new URL("./v7-theme.css", import.meta.url),
  "utf8",
);
const tokenCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const shellCss = readFileSync(
  new URL("./v7-shell.css", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../main.tsx", import.meta.url),
  "utf8",
);

const PAPER_LIGHT_TOKENS = {
  "--paper-light-canvas": "#f4f7f2",
  "--paper-light-canvas-soft": "#e9efea",
  "--paper-light-surface": "#ffffff",
  "--paper-light-surface-strong": "#f0f3ef",
  "--paper-light-surface-hover": "#e2e8e3",
  "--paper-light-border": "rgb(8 10 10 / 12%)",
  "--paper-light-border-strong": "rgb(8 10 10 / 20%)",
  "--paper-light-text": "#080a0a",
  "--paper-light-text-muted": "#4c5650",
  "--paper-light-text-faint": "#66716a",
  "--paper-light-shadow": "rgb(8 10 10 / 18%)",
  "--paper-light-focus": "#167682",
  "--paper-light-primary": "#79e1a2",
  "--paper-light-on-primary": "#061b11",
  "--paper-light-danger": "#b34e47",
} as const;

function ruleBody(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));

  expect(match, `missing CSS rule: ${selector}`).not.toBeNull();
  return match![1];
}

function ruleBodies(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...css.matchAll(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "g")),
  ].map(([, body]) => body);
}

describe("Paper light theme contract", () => {
  it("keeps the checked-in semantic colors equal to the Paper design", () => {
    const normalizedCss = tokenCss.toLowerCase();

    for (const [token, value] of Object.entries(PAPER_LIGHT_TOKENS)) {
      expect(normalizedCss).toContain(`${token}: ${value};`);
    }
  });

  it("loads Paper tokens first and the semantic v7 resolver last", () => {
    const imports = [
      ...mainSource.matchAll(/import "\.\/styles\/(.+?\.css)";/g),
    ].map(([, file]) => file);

    expect(imports[0]).toBe("tokens.css");
    expect(imports.at(-1)).toBe("v7-theme.css");

    for (const file of [
      "v7-shell.css",
      "v7-gallery.css",
      "v7-settings-trash.css",
      "v7-preview.css",
      "v7-modal.css",
    ]) {
      expect(imports.indexOf(file)).toBeGreaterThan(
        imports.indexOf("tokens.css"),
      );
      expect(imports.indexOf(file)).toBeLessThan(
        imports.indexOf("v7-theme.css"),
      );
    }
  });

  it("keeps the entire shell on resolved semantic roles", () => {
    const contract: Record<string, string[]> = {
      ".v7-app": ["color: var(--v7-text);", "background: var(--v7-canvas);"],
      ".v7-window-bar": [
        "border-bottom: 1px solid var(--v7-border);",
        "background: var(--v7-canvas-soft);",
      ],
      ".v7-window-identity strong": ["color: var(--v7-text);"],
      ".v7-global-search": [
        "border: 1px solid var(--v7-border);",
        "color: var(--v7-text-faint);",
        "background: var(--v7-surface);",
      ],
      ".v7-global-search input": ["color: var(--v7-text);"],
      ".v7-sidebar": [
        "background: var(--v7-canvas-soft);",
        "box-shadow: 1px 0 0 var(--v7-border);",
      ],
      ".v7-sidebar-row": ["color: var(--v7-text-muted);"],
      ".v7-sidebar-row:hover": [
        "color: var(--v7-text);",
        "background: var(--v7-surface-hover);",
      ],
      '.v7-sidebar-row[data-active="true"]': [
        "color: var(--v7-text);",
        "background: var(--v7-surface-hover);",
      ],
      ".v7-workspace": ["background: var(--v7-canvas);"],
      ".v7-page-bar": [
        "border-bottom: 1px solid var(--v7-border);",
        "background: var(--v7-canvas);",
      ],
      ".v7-page-title h1": ["color: var(--v7-text);"],
      ".v7-page-title span": ["color: var(--v7-text-faint);"],
    };

    for (const [selector, declarations] of Object.entries(contract)) {
      const body = ruleBody(shellCss, selector);
      for (const declaration of declarations) {
        expect(body).toContain(declaration);
      }
    }
  });

  it("never rebinds light appearance to dark Paper primitives", () => {
    const lightOverrides = [
      ...themeCss.matchAll(/:root\[data-theme="light"\][^{]*\{([\s\S]*?)\}/g),
    ]
      .map(([, body]) => body)
      .join("\n");

    expect(lightOverrides).not.toContain("--paper-dark-");
    expect(themeCss).not.toContain("dark chrome");
    expect(shellCss).not.toContain("#080a0a");
    expect(shellCss).not.toContain("#111413");
  });

  it("keeps the focused preview canvas on light Paper surfaces", () => {
    expect(
      ruleBodies(
        themeCss,
        ':root[data-theme="light"] .v7-app .v7-focused-preview-pane',
      ).some((body) => body.includes("background: var(--theme-surface);")),
    ).toBe(true);
    expect(
      ruleBodies(
        themeCss,
        ':root[data-theme="light"] .v7-app .v7-focused-image-stage',
      ).some((body) => body.includes("background: var(--theme-canvas-soft);")),
    ).toBe(true);
  });

  it("preserves both the dark and full-light semantic mappings", () => {
    const darkRoles = ruleBody(tokenCss, ":root");
    const lightRoles = ruleBody(tokenCss, ':root[data-theme="light"]');
    const roles = [
      "canvas",
      "canvas-soft",
      "surface",
      "surface-strong",
      "surface-hover",
      "border",
      "border-strong",
      "text",
      "text-muted",
      "text-faint",
      "focus",
      "primary",
      "on-primary",
      "danger",
    ];

    for (const role of roles) {
      expect(darkRoles).toContain(
        `--theme-${role}: var(--paper-dark-${role});`,
      );
      expect(lightRoles).toContain(
        `--theme-${role}: var(--paper-light-${role});`,
      );
    }
  });
});
