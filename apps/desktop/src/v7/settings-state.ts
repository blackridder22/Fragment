import {
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_ACTION_IDS,
  normalizeShortcutBinding,
  type ShortcutActionId,
  type ShortcutBinding,
} from "../features/shortcuts/shortcut-model";

export const V7_SETTINGS_STORAGE_KEY = "fragment.v7.settings";
export const V7_SETTINGS_VERSION = 1;

export type DefaultFragmentDestination = "ask" | "inbox" | "recent";

export type V7SettingsState = Readonly<{
  defaultFragment: DefaultFragmentDestination;
  preventDuplicates: boolean;
  refreshOnFocus: boolean;
  captureConfirmations: boolean;
  reduceMotion: boolean;
  shortcuts: Readonly<Record<ShortcutActionId, ShortcutBinding>>;
}>;

export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_V7_SETTINGS_STATE: V7SettingsState = Object.freeze({
  defaultFragment: "ask",
  preventDuplicates: true,
  refreshOnFocus: true,
  captureConfirmations: true,
  reduceMotion: false,
  shortcuts: DEFAULT_SHORTCUT_BINDINGS,
});

type StoredV7Settings = {
  version: typeof V7_SETTINGS_VERSION;
  settings: V7SettingsState;
};

const DEFAULT_DESTINATIONS: ReadonlySet<DefaultFragmentDestination> = new Set([
  "ask",
  "inbox",
  "recent",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function browserStorage(): SettingsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeV7SettingsState(value: unknown): V7SettingsState {
  if (!isRecord(value)) {
    return defaultSettingsState();
  }

  const defaultFragment = DEFAULT_DESTINATIONS.has(
    value.defaultFragment as DefaultFragmentDestination,
  )
    ? (value.defaultFragment as DefaultFragmentDestination)
    : DEFAULT_V7_SETTINGS_STATE.defaultFragment;

  return {
    defaultFragment,
    preventDuplicates:
      typeof value.preventDuplicates === "boolean"
        ? value.preventDuplicates
        : DEFAULT_V7_SETTINGS_STATE.preventDuplicates,
    refreshOnFocus:
      typeof value.refreshOnFocus === "boolean"
        ? value.refreshOnFocus
        : DEFAULT_V7_SETTINGS_STATE.refreshOnFocus,
    captureConfirmations:
      typeof value.captureConfirmations === "boolean"
        ? value.captureConfirmations
        : DEFAULT_V7_SETTINGS_STATE.captureConfirmations,
    reduceMotion:
      typeof value.reduceMotion === "boolean"
        ? value.reduceMotion
        : DEFAULT_V7_SETTINGS_STATE.reduceMotion,
    shortcuts: normalizeShortcutBindings(value.shortcuts),
  };
}

function normalizeShortcutBindings(
  value: unknown,
): Readonly<Record<ShortcutActionId, ShortcutBinding>> {
  const stored = isRecord(value) ? value : {};
  return Object.freeze(
    Object.fromEntries(
      SHORTCUT_ACTION_IDS.map((actionId) => [
        actionId,
        normalizeShortcutBinding(stored[actionId]) ??
          DEFAULT_SHORTCUT_BINDINGS[actionId],
      ]),
    ) as Record<ShortcutActionId, ShortcutBinding>,
  );
}

function defaultSettingsState(): V7SettingsState {
  return {
    ...DEFAULT_V7_SETTINGS_STATE,
    shortcuts: normalizeShortcutBindings(null),
  };
}

export function parseV7SettingsState(raw: string | null): V7SettingsState {
  if (!raw) {
    return defaultSettingsState();
  }

  try {
    const stored = JSON.parse(raw) as unknown;
    if (
      !isRecord(stored) ||
      stored.version !== V7_SETTINGS_VERSION ||
      !("settings" in stored)
    ) {
      return defaultSettingsState();
    }

    return normalizeV7SettingsState(stored.settings);
  } catch {
    return defaultSettingsState();
  }
}

export function readV7SettingsState(
  storage: SettingsStorage | null = browserStorage(),
): V7SettingsState {
  if (!storage) {
    return defaultSettingsState();
  }

  try {
    return parseV7SettingsState(storage.getItem(V7_SETTINGS_STORAGE_KEY));
  } catch {
    return defaultSettingsState();
  }
}

export function writeV7SettingsState(
  settings: V7SettingsState,
  storage: SettingsStorage | null = browserStorage(),
): boolean {
  if (!storage) {
    return false;
  }

  const payload: StoredV7Settings = {
    version: V7_SETTINGS_VERSION,
    settings: normalizeV7SettingsState(settings),
  };

  try {
    storage.setItem(V7_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function patchV7SettingsState(
  settings: V7SettingsState,
  patch: Partial<V7SettingsState>,
): V7SettingsState {
  return normalizeV7SettingsState({ ...settings, ...patch });
}
