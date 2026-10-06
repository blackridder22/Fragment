import { FolderOpen } from "lucide-react";
import { useState } from "react";
import type { PaletteIndexStatus } from "@fragment/shared";
import { SHORTCUT_DEFINITIONS } from "../features/shortcuts/shortcut-model";
import type {
  DeletePolicy,
  NativeHostStatus,
  SettingsSection,
  ThemePreference,
} from "../store/library-types";
import {
  NativeHostStatusControl,
  PreferenceGroup,
  PreferenceRow,
  SelectControl,
  SettingsHeading,
  ShortcutRow,
  SwitchControl,
  ThemeControl,
  deletePolicyDescription,
} from "./settings-controls";
import {
  DEFAULT_V7_SETTINGS_STATE,
  patchV7SettingsState,
  readV7SettingsState,
  writeV7SettingsState,
  type DefaultFragmentDestination,
  type V7SettingsState,
} from "./settings-state";

export type {
  DeletePolicy,
  NativeHostStatus,
  SettingsSection,
  ThemePreference,
} from "../store/library-types";
type MaybePromise = void | Promise<void>;

const DEFAULT_NATIVE_HOST_STATUS: NativeHostStatus = Object.freeze({
  state: "unknown",
  label: "Not checked",
  description: "Native capture host status has not been checked yet.",
});

export type SettingsPageProps = {
  /** Controlled section; uncontrolled (starting at General) when omitted. */
  section?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
  paletteIndex?: PaletteIndexStatus | null;
  theme: ThemePreference;
  deletePolicy: DeletePolicy;
  settings?: V7SettingsState;
  vaultPath?: string;
  nativeHostStatus?: NativeHostStatus;
  onThemeChange: (theme: ThemePreference) => void;
  onDeletePolicyChange: (policy: DeletePolicy) => void;
  onSettingsChange?: (settings: V7SettingsState) => void;
  onRefreshNativeHostStatus?: () => MaybePromise;
  onRevealVault?: () => MaybePromise;
  onResetToDefaults?: () => MaybePromise;
};

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
}> = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "capture", label: "Capture" },
  { id: "storage", label: "Storage" },
  { id: "shortcuts", label: "Shortcuts" },
];

const DEFAULT_FRAGMENT_OPTIONS: Array<{
  label: string;
  value: DefaultFragmentDestination;
}> = [
  { label: "Current Frame or Inbox", value: "ask" },
  { label: "Inbox", value: "inbox" },
  { label: "Last used Frame", value: "recent" },
];

const DELETE_POLICY_OPTIONS: Array<{
  label: string;
  value: DeletePolicy;
}> = [
  { label: "Immediately", value: "forever" },
  { label: "After 7 days", value: "7" },
  { label: "After 14 days", value: "14" },
  { label: "After 24 days", value: "24" },
  { label: "After 31 days", value: "31" },
];

export function SettingsPage({
  section: controlledSection,
  onSectionChange,
  paletteIndex,
  theme,
  deletePolicy,
  settings,
  vaultPath = "~/Library/Application Support/Fragment",
  nativeHostStatus,
  onThemeChange,
  onDeletePolicyChange,
  onSettingsChange,
  onRefreshNativeHostStatus,
  onRevealVault,
  onResetToDefaults,
}: SettingsPageProps) {
  const [localSection, setLocalSection] = useState<SettingsSection>("general");
  const section = controlledSection ?? localSection;
  const setSection = (next: SettingsSection) => {
    setLocalSection(next);
    onSectionChange?.(next);
  };
  const [storedSettings, setStoredSettings] = useState(readV7SettingsState);
  const [resetting, setResetting] = useState(false);
  const currentSettings = settings ?? storedSettings;
  const currentNativeHostStatus =
    nativeHostStatus ?? DEFAULT_NATIVE_HOST_STATUS;

  function updateSettings(patch: Partial<V7SettingsState>) {
    const next = patchV7SettingsState(currentSettings, patch);
    if (!settings) {
      setStoredSettings(next);
    }
    writeV7SettingsState(next);
    onSettingsChange?.(next);
  }

  async function resetToDefaults() {
    setResetting(true);
    const nextSettings = { ...DEFAULT_V7_SETTINGS_STATE };
    if (!settings) {
      setStoredSettings(nextSettings);
    }
    writeV7SettingsState(nextSettings);
    onSettingsChange?.(nextSettings);
    onThemeChange("system");
    onDeletePolicyChange("31");
    try {
      await onResetToDefaults?.();
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="v7-settings-page" aria-labelledby="v7-settings-title">
      <header className="v7-settings-pagebar">
        <div className="v7-settings-title-stack">
          <h1 id="v7-settings-title">Settings</h1>
          <p>Preferences stay local on this Mac</p>
        </div>
        <button
          className="v7-settings-reset"
          disabled={resetting}
          onClick={() => void resetToDefaults()}
          type="button"
        >
          {resetting ? "Resetting…" : "Reset to defaults"}
        </button>
      </header>

      <div className="v7-settings-content">
        <nav className="v7-settings-sections" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              aria-current={section === item.id ? "page" : undefined}
              data-active={section === item.id}
              key={item.id}
              onClick={() => setSection(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="v7-settings-main" data-section={section}>
          {section === "general" ? (
            <>
              <SettingsHeading
                description="Choose how Fragment behaves on this Mac."
                title="General"
              />
              <PreferenceGroup label="Library">
                <PreferenceRow
                  control={
                    <div className="v7-settings-path-control">
                      <span title={vaultPath}>{vaultPath}</span>
                      <button
                        disabled={!onRevealVault}
                        onClick={() => void onRevealVault?.()}
                        type="button"
                      >
                        Reveal
                      </button>
                    </div>
                  }
                  description="Originals and previews stay on this Mac."
                  label="Vault location"
                />
                <PreferenceRow
                  control={
                    <SelectControl
                      ariaLabel="Desktop import destination"
                      options={DEFAULT_FRAGMENT_OPTIONS}
                      value={currentSettings.defaultFragment}
                      onChange={(defaultFragment) =>
                        updateSettings({ defaultFragment })
                      }
                    />
                  }
                  description="Where Fragments imported from this Mac are saved."
                  label="Desktop import destination"
                />
                <PreferenceRow
                  control={<span className="v7-settings-value">Always on</span>}
                  description="Exact image matches reuse the existing asset instead of storing another copy."
                  label="Prevent exact duplicates"
                  last
                />
              </PreferenceGroup>

              <PreferenceGroup label="App behavior">
                <PreferenceRow
                  compact
                  control={
                    <SwitchControl
                      checked={currentSettings.refreshOnFocus}
                      label="Refresh when app gains focus"
                      onChange={(refreshOnFocus) =>
                        updateSettings({ refreshOnFocus })
                      }
                    />
                  }
                  description="Show Fragments captured in the browser immediately."
                  label="Refresh when app gains focus"
                />
                <PreferenceRow
                  compact
                  control={<span className="v7-settings-value">Always on</span>}
                  description="Keep lightweight success feedback in the browser."
                  label="Show capture confirmations"
                />
                <PreferenceRow
                  compact
                  control={
                    <SwitchControl
                      checked={currentSettings.reduceMotion}
                      label="Reduce interface motion"
                      onChange={(reduceMotion) =>
                        updateSettings({ reduceMotion })
                      }
                    />
                  }
                  description="Minimize preview and drawer transitions."
                  label="Reduce interface motion"
                  last
                />
              </PreferenceGroup>
            </>
          ) : null}

          {section === "appearance" ? (
            <>
              <SettingsHeading
                description="Choose how Fragment looks on this Mac."
                title="Appearance"
              />
              <PreferenceGroup label="Interface">
                <PreferenceRow
                  control={
                    <ThemeControl value={theme} onChange={onThemeChange} />
                  }
                  description="Follow macOS or keep a fixed appearance."
                  label="Window theme"
                  last
                />
              </PreferenceGroup>
            </>
          ) : null}

          {section === "capture" ? (
            <>
              <SettingsHeading
                description="Control browser capture without interrupting your flow."
                title="Capture"
              />
              <PreferenceGroup label="Browser capture">
                <PreferenceRow
                  control={
                    <NativeHostStatusControl
                      status={currentNativeHostStatus}
                      onRefresh={onRefreshNativeHostStatus}
                    />
                  }
                  description={
                    currentNativeHostStatus.description ??
                    "Bundled with Fragment Desktop."
                  }
                  label="Native capture host"
                />
                <PreferenceRow
                  control={
                    <span className="v7-settings-value">
                      Choose during capture
                    </span>
                  }
                  description="The inline capture picker chooses one or more destination Frames."
                  label="Capture destination"
                />
                <PreferenceRow
                  control={<span className="v7-settings-value">Always on</span>}
                  description="Keep lightweight success feedback in the browser."
                  label="Show capture confirmations"
                  last
                />
              </PreferenceGroup>
            </>
          ) : null}

          {section === "storage" ? (
            <>
              <SettingsHeading
                description="Manage the local Vault and deleted-item retention."
                title="Storage"
              />
              <PreferenceGroup label="Local vault">
                {paletteIndex ? (
                  <PreferenceRow
                    label="Color palettes"
                    description="Colors are extracted locally while Fragment is open."
                    control={
                      <span>
                        {paletteIndex.ready + paletteIndex.empty} processed ·{" "}
                        {paletteIndex.pending} pending · {paletteIndex.failed}{" "}
                        failed
                      </span>
                    }
                  />
                ) : null}
                <PreferenceRow
                  control={
                    <button
                      className="v7-settings-reveal-control"
                      disabled={!onRevealVault}
                      onClick={() => void onRevealVault?.()}
                      type="button"
                    >
                      <FolderOpen aria-hidden="true" size={14} />
                      Reveal in Finder
                    </button>
                  }
                  description="Originals, previews, and metadata stay on this Mac."
                  label="Vault location"
                />
                <PreferenceRow
                  control={
                    <SelectControl
                      ariaLabel="Delete behavior"
                      options={DELETE_POLICY_OPTIONS}
                      value={deletePolicy}
                      onChange={onDeletePolicyChange}
                    />
                  }
                  description={deletePolicyDescription(deletePolicy)}
                  label="Delete behavior"
                  last
                />
              </PreferenceGroup>
            </>
          ) : null}

          {section === "shortcuts" ? (
            <>
              <SettingsHeading
                description="Keep the most useful actions close to the keyboard."
                title="Shortcuts"
              />
              <PreferenceGroup label="Keyboard">
                {SHORTCUT_DEFINITIONS.map((definition, index) => (
                  <ShortcutRow
                    actionId={definition.id}
                    binding={currentSettings.shortcuts[definition.id]}
                    bindings={currentSettings.shortcuts}
                    description={definition.description}
                    key={definition.id}
                    label={definition.label}
                    last={index === SHORTCUT_DEFINITIONS.length - 1}
                    onChange={(binding) =>
                      updateSettings({
                        shortcuts: {
                          ...currentSettings.shortcuts,
                          [definition.id]: binding,
                        },
                      })
                    }
                  />
                ))}
              </PreferenceGroup>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
