import { describe, expect, it } from "vitest";
import {
  createSelectionState,
  resolveSelectedIds,
  selectionKeyboardIntent,
  selectionReducer,
} from "./selection-model";

const vaultScope = "home|all|all";
const trashScope = "trash|all|all";
const ids = ["a", "b", "c", "d", "e"];

describe("selectionReducer", () => {
  it("toggles explicit IDs in visual order and prunes deleted records", () => {
    let state = createSelectionState(vaultScope);
    state = selectionReducer(state, {
      type: "toggle",
      scopeKey: vaultScope,
      matchingIds: ids,
      id: "d",
    });
    state = selectionReducer(state, {
      type: "toggle",
      scopeKey: vaultScope,
      matchingIds: ids,
      id: "b",
    });

    expect(resolveSelectedIds(state, vaultScope, ids)).toEqual(["b", "d"]);

    state = selectionReducer(state, {
      type: "reconcile",
      scopeKey: vaultScope,
      matchingIds: ["a", "b", "c"],
    });
    expect(resolveSelectedIds(state, vaultScope, ["a", "b", "c"])).toEqual([
      "b",
    ]);
  });

  it("keeps all-matching selection query-aware as records refresh", () => {
    let state = selectionReducer(createSelectionState(vaultScope), {
      type: "select-all",
      scopeKey: vaultScope,
      matchingIds: ["a", "b"],
    });

    expect(state.mode).toBe("all-matching");
    expect(resolveSelectedIds(state, vaultScope, ["a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);

    state = selectionReducer(state, {
      type: "toggle",
      scopeKey: vaultScope,
      matchingIds: ["a", "b", "c"],
      id: "b",
    });
    expect(resolveSelectedIds(state, vaultScope, ["a", "b", "c", "d"])).toEqual(
      ["a", "c", "d"],
    );
  });

  it("clears selection when the query or Vault/Trash scope changes", () => {
    const selected = selectionReducer(createSelectionState(vaultScope), {
      type: "select-all",
      scopeKey: vaultScope,
      matchingIds: ids,
    });
    const reconciled = selectionReducer(selected, {
      type: "reconcile",
      scopeKey: trashScope,
      matchingIds: ["trash-a", "trash-b"],
    });

    expect(
      resolveSelectedIds(reconciled, trashScope, ["trash-a", "trash-b"]),
    ).toEqual([]);
    expect(resolveSelectedIds(selected, "home|search|all", ids)).toEqual([]);
  });

  it("selects visual ranges and supports additive Command+Shift ranges", () => {
    let state = selectionReducer(createSelectionState(vaultScope), {
      type: "toggle",
      scopeKey: vaultScope,
      matchingIds: ids,
      id: "b",
    });
    state = selectionReducer(state, {
      type: "range",
      scopeKey: vaultScope,
      matchingIds: ids,
      id: "d",
    });
    expect(resolveSelectedIds(state, vaultScope, ids)).toEqual(["b", "c", "d"]);

    state = selectionReducer(state, {
      type: "toggle",
      scopeKey: vaultScope,
      matchingIds: ids,
      id: "a",
    });
    state = selectionReducer(state, {
      type: "range",
      scopeKey: vaultScope,
      matchingIds: ids,
      id: "c",
      additive: true,
    });
    expect(resolveSelectedIds(state, vaultScope, ids)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("clears with Escape and toggles the focused card with Space", () => {
    let state = selectionReducer(createSelectionState(vaultScope), {
      type: "toggle",
      scopeKey: vaultScope,
      matchingIds: ids,
      id: "c",
    });
    expect(selectionKeyboardIntent(" ", { hasFocusedItem: true })).toBe(
      "toggle-focused",
    );
    state = selectionReducer(state, {
      type: "toggle",
      scopeKey: vaultScope,
      matchingIds: ids,
      id: "c",
    });
    expect(resolveSelectedIds(state, vaultScope, ids)).toEqual([]);

    expect(selectionKeyboardIntent("Escape")).toBe("clear");
    expect(selectionKeyboardIntent("a", { metaKey: true })).toBe("select-all");
    expect(selectionKeyboardIntent("a", { ctrlKey: true })).toBe("select-all");
    expect(selectionKeyboardIntent(" ")).toBeNull();
  });
});
