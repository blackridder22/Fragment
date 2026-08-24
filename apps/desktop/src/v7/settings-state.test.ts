import { describe, expect, it } from "vitest";
import {
  DEFAULT_V7_SETTINGS_STATE,
  V7_SETTINGS_STORAGE_KEY,
  V7_SETTINGS_VERSION,
  parseV7SettingsState,
  patchV7SettingsState,
  readV7SettingsState,
  writeV7SettingsState,
  type SettingsStorage,
} from "./settings-state";
import { DEFAULT_SHORTCUT_BINDINGS } from "../features/shortcuts/shortcut-model";

function createStorage(initialValue: string | null = null): SettingsStorage & {
  value: string | null;
} {
  return {
    value: initialValue,
    getItem(key) {
      expect(key).toBe(V7_SETTINGS_STORAGE_KEY);
      return this.value;
    },
    setItem(key, value) {
      expect(key).toBe(V7_SETTINGS_STORAGE_KEY);
      this.value = value;
    },
  };
}

describe("v7 settings state", () => {
  it("uses defaults for missing, malformed, and unsupported versions", () => {
    expect(parseV7SettingsState(null)).toEqual(DEFAULT_V7_SETTINGS_STATE);
    expect(parseV7SettingsState("not json")).toEqual(DEFAULT_V7_SETTINGS_STATE);
    expect(
      parseV7SettingsState(
        JSON.stringify({
          version: V7_SETTINGS_VERSION + 1,
          settings: { reduceMotion: true },
        }),
      ),
    ).toEqual(DEFAULT_V7_SETTINGS_STATE);
  });

  it("restores valid values and repairs invalid fields independently", () => {
    expect(
      parseV7SettingsState(
        JSON.stringify({
          version: V7_SETTINGS_VERSION,
          settings: {
            defaultFragment: "recent",
            preventDuplicates: false,
            refreshOnFocus: "yes",
            captureConfirmations: false,
            reduceMotion: true,
          },
        }),
      ),
    ).toEqual({
      defaultFragment: "recent",
      preventDuplicates: false,
      refreshOnFocus: true,
      captureConfirmations: false,
      reduceMotion: true,
      shortcuts: DEFAULT_SHORTCUT_BINDINGS,
    });
  });

  it("restores valid shortcut overrides and repairs invalid ones", () => {
    expect(
      parseV7SettingsState(
        JSON.stringify({
          version: V7_SETTINGS_VERSION,
          settings: {
            shortcuts: {
              search: { code: "KeyF", mod: true, shift: true, alt: false },
              importFrames: { code: 42 },
              quickPreview: { code: "Enter" },
              closeOverlay: { code: "Backspace", alt: true },
            },
          },
        }),
      ).shortcuts,
    ).toEqual({
      search: { code: "KeyF", mod: true, shift: true, alt: false },
      importFrames: DEFAULT_SHORTCUT_BINDINGS.importFrames,
      quickPreview: { code: "Enter", mod: false, shift: false, alt: false },
      closeOverlay: {
        code: "Backspace",
        mod: false,
        shift: false,
        alt: true,
      },
    });
  });

  it("writes and reads the versioned state envelope", () => {
    const storage = createStorage();
    const next = patchV7SettingsState(DEFAULT_V7_SETTINGS_STATE, {
      defaultFragment: "inbox",
      preventDuplicates: false,
      reduceMotion: true,
    });

    expect(writeV7SettingsState(next, storage)).toBe(true);
    expect(JSON.parse(storage.value ?? "{}")).toEqual({
      version: V7_SETTINGS_VERSION,
      settings: next,
    });
    expect(readV7SettingsState(storage)).toEqual(next);
  });

  it("falls back safely when storage is unavailable", () => {
    const unavailableStorage: SettingsStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };

    expect(readV7SettingsState(unavailableStorage)).toEqual(
      DEFAULT_V7_SETTINGS_STATE,
    );
    expect(
      writeV7SettingsState(DEFAULT_V7_SETTINGS_STATE, unavailableStorage),
    ).toBe(false);
  });
});
