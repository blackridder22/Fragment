import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUT_BINDINGS } from "../features/shortcuts/shortcut-model";
import { resolvePreviewKey, type PreviewKeyContext } from "./preview-keyboard";

const base: PreviewKeyContext = {
  closeBinding: DEFAULT_SHORTCUT_BINDINGS.closeOverlay,
  editing: false,
  innerEditorOpen: false,
  canGoPrevious: true,
  canGoNext: true,
  canCopy: true,
  canTrash: true,
  canSaveNotes: true,
};

describe("resolvePreviewKey", () => {
  it("navigates with the arrow keys and respects the collection edges", () => {
    expect(
      resolvePreviewKey({ key: "ArrowLeft", code: "ArrowLeft" }, base),
    ).toBe("previous");
    expect(
      resolvePreviewKey({ key: "ArrowRight", code: "ArrowRight" }, base),
    ).toBe("next");
    expect(
      resolvePreviewKey(
        { key: "ArrowLeft", code: "ArrowLeft" },
        { ...base, canGoPrevious: false },
      ),
    ).toBe("none");
    expect(
      resolvePreviewKey(
        { key: "ArrowRight", code: "ArrowRight" },
        { ...base, canGoNext: false },
      ),
    ).toBe("none");
  });

  it("keeps navigating while an arrow key repeats", () => {
    expect(
      resolvePreviewKey(
        { key: "ArrowRight", code: "ArrowRight", repeat: true },
        base,
      ),
    ).toBe("next");
  });

  it("closes an inner editor before closing the overlay", () => {
    expect(resolvePreviewKey({ key: "Escape", code: "Escape" }, base)).toBe(
      "close",
    );
    expect(
      resolvePreviewKey(
        { key: "Escape", code: "Escape" },
        { ...base, innerEditorOpen: true },
      ),
    ).toBe("close-editor");
    expect(
      resolvePreviewKey(
        { key: "Escape", code: "Escape" },
        { ...base, innerEditorOpen: true, editing: true },
      ),
    ).toBe("close-editor");
  });

  it("leaves the close shortcut to another layer when disabled", () => {
    expect(
      resolvePreviewKey(
        { key: "Escape", code: "Escape" },
        { ...base, closeDisabled: true },
      ),
    ).toBe("none");
  });

  it("honours a custom close binding", () => {
    const context = {
      ...base,
      closeBinding: { code: "KeyW", mod: true, shift: false, alt: false },
    };
    expect(
      resolvePreviewKey({ key: "w", code: "KeyW", metaKey: true }, context),
    ).toBe("close");
    expect(resolvePreviewKey({ key: "Escape", code: "Escape" }, context)).toBe(
      "none",
    );
  });

  it("copies with Cmd+C or Ctrl+C only when a copy action exists", () => {
    expect(
      resolvePreviewKey({ key: "c", code: "KeyC", metaKey: true }, base),
    ).toBe("copy");
    expect(
      resolvePreviewKey({ key: "c", code: "KeyC", ctrlKey: true }, base),
    ).toBe("copy");
    expect(
      resolvePreviewKey(
        { key: "c", code: "KeyC", metaKey: true },
        { ...base, canCopy: false },
      ),
    ).toBe("none");
    expect(resolvePreviewKey({ key: "c", code: "KeyC" }, base)).toBe("none");
    expect(
      resolvePreviewKey(
        { key: "c", code: "KeyC", metaKey: true, shiftKey: true },
        base,
      ),
    ).toBe("none");
  });

  it("moves to Trash with Cmd+Backspace", () => {
    expect(
      resolvePreviewKey(
        { key: "Backspace", code: "Backspace", metaKey: true },
        base,
      ),
    ).toBe("trash");
    expect(
      resolvePreviewKey({ key: "Backspace", code: "Backspace" }, base),
    ).toBe("none");
    expect(
      resolvePreviewKey(
        { key: "Backspace", code: "Backspace", metaKey: true },
        { ...base, canTrash: false },
      ),
    ).toBe("none");
  });

  it("saves notes with Cmd+S even while typing in the notes field", () => {
    expect(
      resolvePreviewKey(
        { key: "s", code: "KeyS", metaKey: true },
        { ...base, editing: true },
      ),
    ).toBe("save-notes");
    expect(
      resolvePreviewKey(
        { key: "s", code: "KeyS", metaKey: true },
        { ...base, canSaveNotes: false },
      ),
    ).toBe("none");
  });

  it("ignores navigation and clipboard keys while typing", () => {
    const editing = { ...base, editing: true };
    expect(
      resolvePreviewKey({ key: "ArrowLeft", code: "ArrowLeft" }, editing),
    ).toBe("none");
    expect(
      resolvePreviewKey({ key: "c", code: "KeyC", metaKey: true }, editing),
    ).toBe("none");
    expect(
      resolvePreviewKey(
        { key: "Backspace", code: "Backspace", metaKey: true },
        editing,
      ),
    ).toBe("none");
  });

  it("leaves Space alone so the host keeps owning quick preview", () => {
    expect(resolvePreviewKey({ key: " ", code: "Space" }, base)).toBe("none");
  });
});
