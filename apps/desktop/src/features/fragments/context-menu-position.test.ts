import { describe, expect, it } from "vitest";
import {
  CONTEXT_MENU_VIEWPORT_INSET,
  clampContextMenuPosition,
} from "./context-menu-position";

describe("context menu positioning", () => {
  it("keeps a measured menu at the requested point when it fits", () => {
    expect(
      clampContextMenuPosition({
        x: 120,
        y: 96,
        menuWidth: 248,
        menuHeight: 312,
        viewportWidth: 1280,
        viewportHeight: 720,
      }),
    ).toEqual({ left: 120, top: 96 });
  });

  it("uses the measured size to keep the menu inside the far edges", () => {
    expect(
      clampContextMenuPosition({
        x: 1240,
        y: 680,
        menuWidth: 248,
        menuHeight: 312,
        viewportWidth: 1280,
        viewportHeight: 720,
      }),
    ).toEqual({ left: 1024, top: 400 });
  });

  it("keeps at least an eight pixel inset at the near edges", () => {
    expect(
      clampContextMenuPosition({
        x: -20,
        y: 2,
        menuWidth: 248,
        menuHeight: 312,
        viewportWidth: 1280,
        viewportHeight: 720,
        inset: 0,
      }),
    ).toEqual({
      left: CONTEXT_MENU_VIEWPORT_INSET,
      top: CONTEXT_MENU_VIEWPORT_INSET,
    });
  });

  it("anchors an oversized menu to the safe inset", () => {
    expect(
      clampContextMenuPosition({
        x: 400,
        y: 300,
        menuWidth: 900,
        menuHeight: 700,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({
      left: CONTEXT_MENU_VIEWPORT_INSET,
      top: CONTEXT_MENU_VIEWPORT_INSET,
    });
  });
});
