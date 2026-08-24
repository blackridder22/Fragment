import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_ACTION_IDS,
  captureShortcutBinding,
  findShortcutConflicts,
  formatShortcutBinding,
  matchesShortcut,
  normalizeShortcutBinding,
  resolveShortcutBindings,
  shortcutSignature,
  validateShortcutBinding,
} from "./shortcut-model";

describe("shortcut defaults", () => {
  it("defines the four supported actions and their canonical bindings", () => {
    expect(SHORTCUT_ACTION_IDS).toEqual([
      "search",
      "importFrames",
      "quickPreview",
      "closeOverlay",
    ]);
    expect(shortcutSignature(DEFAULT_SHORTCUT_BINDINGS.search)).toBe(
      "Mod+KeyK",
    );
    expect(shortcutSignature(DEFAULT_SHORTCUT_BINDINGS.importFrames)).toBe(
      "Mod+KeyI",
    );
    expect(shortcutSignature(DEFAULT_SHORTCUT_BINDINGS.quickPreview)).toBe(
      "Space",
    );
    expect(shortcutSignature(DEFAULT_SHORTCUT_BINDINGS.closeOverlay)).toBe(
      "Escape",
    );
  });
});

describe("shortcut capture and normalization", () => {
  it("captures Meta and Control as Mod and normalizes event codes", () => {
    expect(
      captureShortcutBinding({ code: "KeyK", key: "k", metaKey: true }),
    ).toEqual({ code: "KeyK", mod: true, shift: false, alt: false });
    expect(captureShortcutBinding({ key: "I", ctrlKey: true })).toEqual({
      code: "KeyI",
      mod: true,
      shift: false,
      alt: false,
    });
    expect(captureShortcutBinding({ key: " " })).toEqual({
      code: "Space",
      mod: false,
      shift: false,
      alt: false,
    });
  });

  it("rejects repeated, composing, unidentified, and ambiguous Mod events", () => {
    expect(captureShortcutBinding({ code: "KeyK", repeat: true })).toBeNull();
    expect(
      captureShortcutBinding({ code: "KeyK", isComposing: true }),
    ).toBeNull();
    expect(captureShortcutBinding({ key: "Unidentified" })).toBeNull();
    expect(
      captureShortcutBinding({
        code: "KeyK",
        metaKey: true,
        ctrlKey: true,
      }),
    ).toBeNull();
  });

  it("repairs canonical code spelling and rejects malformed modifiers", () => {
    expect(normalizeShortcutBinding({ code: "keyk", mod: true })).toEqual({
      code: "KeyK",
      mod: true,
      shift: false,
      alt: false,
    });
    expect(normalizeShortcutBinding({ code: "Esc" })).toEqual({
      code: "Escape",
      mod: false,
      shift: false,
      alt: false,
    });
    expect(normalizeShortcutBinding({ code: "KeyK", mod: "yes" })).toBeNull();
  });
});

describe("shortcut matching and formatting", () => {
  it("requires an exact key and exact modifiers", () => {
    const search = DEFAULT_SHORTCUT_BINDINGS.search;
    expect(matchesShortcut({ code: "KeyK", metaKey: true }, search)).toBe(true);
    expect(matchesShortcut({ code: "KeyK", ctrlKey: true }, search)).toBe(true);
    expect(
      matchesShortcut({ code: "KeyK", metaKey: true, shiftKey: true }, search),
    ).toBe(false);
    expect(
      matchesShortcut({ code: "KeyK", metaKey: true, altKey: true }, search),
    ).toBe(false);
    expect(matchesShortcut({ code: "KeyI", metaKey: true }, search)).toBe(
      false,
    );
  });

  it("formats Mod and semantic keys for macOS and non-macOS", () => {
    expect(formatShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.search)).toBe("⌘ K");
    expect(
      formatShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.search, "windows"),
    ).toBe("Ctrl+K");
    expect(formatShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.quickPreview)).toBe(
      "Space",
    );
    expect(formatShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.closeOverlay)).toBe(
      "Esc",
    );
  });
});

describe("shortcut validation", () => {
  it("rejects modifier-only bindings", () => {
    expect(
      validateShortcutBinding("search", {
        code: "ShiftLeft",
        mod: false,
        shift: true,
        alt: false,
      }).map((issue) => issue.code),
    ).toContain("modifier-only");
  });

  it("rejects operating-system-reserved bindings", () => {
    expect(
      validateShortcutBinding("search", {
        code: "KeyQ",
        mod: true,
        shift: false,
        alt: false,
      }).map((issue) => issue.code),
    ).toContain("reserved-os");
    expect(
      validateShortcutBinding("search", {
        code: "Tab",
        mod: false,
        shift: false,
        alt: true,
      }).map((issue) => issue.code),
    ).toContain("reserved-os");
  });

  it("requires a safe modifier for printable global shortcuts", () => {
    expect(
      validateShortcutBinding("search", {
        code: "KeyK",
        mod: false,
        shift: false,
        alt: false,
      }).map((issue) => issue.code),
    ).toContain("global-printable");
    expect(
      validateShortcutBinding("quickPreview", {
        code: "KeyP",
        mod: false,
        shift: false,
        alt: false,
      }),
    ).toEqual([]);
  });
});

describe("shortcut conflicts", () => {
  it("has no conflicts in the default map", () => {
    expect(findShortcutConflicts(DEFAULT_SHORTCUT_BINDINGS)).toEqual([]);
  });

  it("reports every action sharing an exact canonical binding", () => {
    const bindings = resolveShortcutBindings({
      importFrames: { ...DEFAULT_SHORTCUT_BINDINGS.search },
    });

    expect(findShortcutConflicts(bindings)).toEqual([
      {
        signature: "Mod+KeyK",
        binding: DEFAULT_SHORTCUT_BINDINGS.search,
        actionIds: ["search", "importFrames"],
      },
    ]);
  });

  it("treats different modifiers as different bindings and permits unbinding", () => {
    const bindings = resolveShortcutBindings({
      importFrames: {
        code: "KeyK",
        mod: true,
        shift: true,
        alt: false,
      },
      closeOverlay: null,
    });

    expect(findShortcutConflicts(bindings)).toEqual([]);
    expect(bindings.closeOverlay).toBeNull();
  });
});
