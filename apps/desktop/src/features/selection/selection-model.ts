export type SelectionState =
  | {
      mode: "explicit";
      scopeKey: string;
      ids: string[];
      anchorId: string | null;
    }
  | {
      mode: "all-matching";
      scopeKey: string;
      excludedIds: string[];
      anchorId: string | null;
    };

export type SelectionAction =
  | { type: "clear"; scopeKey: string }
  | { type: "reconcile"; scopeKey: string; matchingIds: string[] }
  | { type: "select-all"; scopeKey: string; matchingIds: string[] }
  | { type: "toggle"; scopeKey: string; matchingIds: string[]; id: string }
  | {
      type: "range";
      scopeKey: string;
      matchingIds: string[];
      id: string;
      additive?: boolean;
    };

export type SelectionKeyboardIntent = "select-all" | "clear" | "toggle-focused";

export function createSelectionState(scopeKey = ""): SelectionState {
  return {
    mode: "explicit",
    scopeKey,
    ids: [],
    anchorId: null,
  };
}

export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  if (action.type === "clear") {
    return createSelectionState(action.scopeKey);
  }

  const matchingIds = unique(action.matchingIds);
  const validIds = new Set(matchingIds);

  if (action.type === "reconcile") {
    if (state.scopeKey !== action.scopeKey) {
      return createSelectionState(action.scopeKey);
    }
    if (state.mode === "all-matching") {
      return {
        ...state,
        excludedIds: state.excludedIds.filter((id) => validIds.has(id)),
        anchorId:
          state.anchorId && validIds.has(state.anchorId)
            ? state.anchorId
            : (matchingIds[0] ?? null),
      };
    }
    return {
      ...state,
      ids: state.ids.filter((id) => validIds.has(id)),
      anchorId:
        state.anchorId && validIds.has(state.anchorId) ? state.anchorId : null,
    };
  }

  if (action.type === "select-all") {
    if (matchingIds.length === 0) {
      return createSelectionState(action.scopeKey);
    }
    return {
      mode: "all-matching",
      scopeKey: action.scopeKey,
      excludedIds: [],
      anchorId: matchingIds[0],
    };
  }

  const scopedState =
    state.scopeKey === action.scopeKey
      ? selectionReducer(state, {
          type: "reconcile",
          scopeKey: action.scopeKey,
          matchingIds,
        })
      : createSelectionState(action.scopeKey);

  if (!validIds.has(action.id)) {
    return scopedState;
  }

  if (action.type === "toggle") {
    if (scopedState.mode === "all-matching") {
      const excluded = new Set(scopedState.excludedIds);
      if (excluded.has(action.id)) {
        excluded.delete(action.id);
      } else {
        excluded.add(action.id);
      }
      if (excluded.size === matchingIds.length) {
        return createSelectionState(action.scopeKey);
      }
      return {
        ...scopedState,
        excludedIds: matchingIds.filter((id) => excluded.has(id)),
        anchorId: action.id,
      };
    }

    const ids = new Set(scopedState.ids);
    if (ids.has(action.id)) {
      ids.delete(action.id);
    } else {
      ids.add(action.id);
    }
    return {
      ...scopedState,
      ids: matchingIds.filter((id) => ids.has(id)),
      anchorId: action.id,
    };
  }

  const anchorId =
    scopedState.anchorId && validIds.has(scopedState.anchorId)
      ? scopedState.anchorId
      : action.id;
  const anchorIndex = matchingIds.indexOf(anchorId);
  const targetIndex = matchingIds.indexOf(action.id);
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const rangeIds = matchingIds.slice(start, end + 1);

  if (!action.additive) {
    return {
      mode: "explicit",
      scopeKey: action.scopeKey,
      ids: rangeIds,
      anchorId,
    };
  }

  const selected = new Set(
    resolveSelectedIds(scopedState, action.scopeKey, matchingIds),
  );
  rangeIds.forEach((id) => selected.add(id));
  return {
    mode: "explicit",
    scopeKey: action.scopeKey,
    ids: matchingIds.filter((id) => selected.has(id)),
    anchorId,
  };
}

export function resolveSelectedIds(
  state: SelectionState,
  scopeKey: string,
  matchingIds: readonly string[],
): string[] {
  if (state.scopeKey !== scopeKey) {
    return [];
  }
  if (state.mode === "all-matching") {
    const excluded = new Set(state.excludedIds);
    return matchingIds.filter((id) => !excluded.has(id));
  }
  const selected = new Set(state.ids);
  return matchingIds.filter((id) => selected.has(id));
}

export function selectionKeyboardIntent(
  key: string,
  options: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    hasFocusedItem?: boolean;
  } = {},
): SelectionKeyboardIntent | null {
  const commandKey = options.metaKey || options.ctrlKey;
  if (commandKey && !options.altKey && key.toLowerCase() === "a") {
    return "select-all";
  }
  if (key === "Escape") {
    return "clear";
  }
  if ((key === " " || key === "Spacebar") && options.hasFocusedItem) {
    return "toggle-focused";
  }
  return null;
}

function unique(ids: readonly string[]) {
  return Array.from(new Set(ids));
}
