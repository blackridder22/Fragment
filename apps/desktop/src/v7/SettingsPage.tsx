import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  LoaderCircle,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { PaletteIndexStatus } from "@fragment/shared";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_DEFINITIONS,
  captureShortcutBinding,
  findShortcutConflicts,
  formatShortcutBinding,
  shortcutSignature,
  validateShortcutBinding,
  type ShortcutActionId,
  type ShortcutBinding,
} from "../features/shortcuts/shortcut-model";
import {
  DEFAULT_V7_SETTINGS_STATE,
  patchV7SettingsState,
  readV7SettingsState,
  writeV7SettingsState,
  type DefaultFragmentDestination,
  type V7SettingsState,
} from "./settings-state";

export type ThemePreference = "light" | "dark" | "system";
export type DeletePolicy = "forever" | "7" | "14" | "24" | "31";
type SettingsSection =
  | "general"
  | "appearance"
  | "capture"
  | "storage"
  | "shortcuts";
type MaybePromise = void | Promise<void>;

export type NativeHostStatus = Readonly<{
  state: "ready" | "checking" | "unavailable" | "error" | "unknown";
  label: string;
  description?: string;
}>;

const DEFAULT_NATIVE_HOST_STATUS: NativeHostStatus = Object.freeze({
  state: "unknown",
  label: "Not checked",
  description: "Native capture host status has not been checked yet.",
});

export type SettingsPageProps = {
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
  { label: "Current Fragment or Inbox", value: "ask" },
  { label: "Inbox", value: "inbox" },
  { label: "Last used Fragment", value: "recent" },
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
  const [section, setSection] = useState<SettingsSection>("general");
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
                  description="Where Frames imported from this Mac are saved."
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
                  description="Show Frames captured in the browser immediately."
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
                  description="The inline capture picker chooses one or more destination Fragments."
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
                {paletteIndex ? <PreferenceRow label="Color palettes" description="Colors are extracted locally while Fragment is open." control={<span>{paletteIndex.ready + paletteIndex.empty} processed · {paletteIndex.pending} pending · {paletteIndex.failed} failed</span>} /> : null}
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

function SettingsHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <header className="v7-settings-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function PreferenceGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section className="v7-settings-group">
      <header>{label}</header>
      {children}
    </section>
  );
}

function PreferenceRow({
  compact = false,
  control,
  description,
  label,
  last = false,
}: {
  compact?: boolean;
  control: ReactNode;
  description: string;
  label: string;
  last?: boolean;
}) {
  return (
    <div className="v7-settings-row" data-compact={compact} data-last={last}>
      <div className="v7-settings-row-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <div className="v7-settings-control-lane">{control}</div>
    </div>
  );
}

function NativeHostStatusControl({
  status,
  onRefresh,
}: {
  status: NativeHostStatus;
  onRefresh?: () => MaybePromise;
}) {
  const icon =
    status.state === "ready" ? (
      <CheckCircle2 aria-hidden="true" size={14} />
    ) : status.state === "checking" ? (
      <LoaderCircle
        aria-hidden="true"
        className="v7-settings-status-spinner"
        size={14}
      />
    ) : (
      <CircleAlert aria-hidden="true" size={14} />
    );
  const content = (
    <>
      {icon}
      <span>{status.label}</span>
    </>
  );

  return onRefresh ? (
    <button
      aria-label="Check native capture host"
      className="v7-settings-status"
      data-state={status.state}
      disabled={status.state === "checking"}
      onClick={() => void onRefresh()}
      type="button"
    >
      {content}
    </button>
  ) : (
    <span className="v7-settings-status" data-state={status.state}>
      {content}
    </span>
  );
}

function ShortcutRow({
  actionId,
  binding,
  bindings,
  description,
  label,
  last = false,
  onChange,
}: {
  actionId: ShortcutActionId;
  binding: ShortcutBinding;
  bindings: V7SettingsState["shortcuts"];
  description: string;
  label: string;
  last?: boolean;
  onChange: (binding: ShortcutBinding) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDefault =
    shortcutSignature(binding) ===
    shortcutSignature(DEFAULT_SHORTCUT_BINDINGS[actionId]);

  return (
    <PreferenceRow
      compact
      control={
        <div className="v7-settings-shortcut-editor">
          {error ? (
            <span className="v7-settings-shortcut-error" title={error}>
              {error}
            </span>
          ) : null}
          <button
            aria-label={`Record shortcut for ${label}`}
            className="v7-settings-shortcut-control"
            data-conflict={Boolean(error)}
            data-recording={recording}
            onBlur={() => setRecording(false)}
            onClick={() => {
              setError(null);
              setRecording(true);
            }}
            onKeyDown={(event) => {
              if (!recording) return;
              event.preventDefault();
              event.stopPropagation();
              const captured = captureShortcutBinding(event);
              if (!captured) return;
              const issue = validateShortcutBinding(actionId, captured)[0];
              if (issue) {
                setError(issue.message);
                return;
              }
              const conflict = findShortcutConflicts({
                ...bindings,
                [actionId]: captured,
              }).find((item) => item.actionIds.includes(actionId));
              if (conflict) {
                const otherAction = conflict.actionIds.find(
                  (id) => id !== actionId,
                );
                const otherLabel = SHORTCUT_DEFINITIONS.find(
                  (item) => item.id === otherAction,
                )?.label;
                setError(`Already used by ${otherLabel ?? "another action"}.`);
                return;
              }
              onChange(captured);
              setError(null);
              setRecording(false);
            }}
            type="button"
          >
            <kbd>
              {recording ? "Press shortcut" : formatShortcutBinding(binding)}
            </kbd>
          </button>
          <button
            aria-label={`Reset ${label} shortcut`}
            className="v7-settings-shortcut-reset"
            disabled={isDefault}
            onClick={() => {
              setError(null);
              setRecording(false);
              onChange(DEFAULT_SHORTCUT_BINDINGS[actionId]);
            }}
            title={isDefault ? "Using default shortcut" : "Restore default"}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
          </button>
        </div>
      }
      description={description}
      label={label}
      last={last}
    />
  );
}

function SwitchControl({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="v7-settings-switch"
      data-checked={checked}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

function ThemeControl({
  onChange,
  value,
}: {
  onChange: (theme: ThemePreference) => void;
  value: ThemePreference;
}) {
  const options: Array<{
    icon: ReactNode;
    label: string;
    value: ThemePreference;
  }> = [
    {
      icon: <Monitor aria-hidden="true" size={13} />,
      label: "System",
      value: "system",
    },
    {
      icon: <Sun aria-hidden="true" size={13} />,
      label: "Light",
      value: "light",
    },
    {
      icon: <Moon aria-hidden="true" size={13} />,
      label: "Dark",
      value: "dark",
    },
  ];

  return (
    <div
      aria-label="Window theme"
      className="v7-settings-theme-control"
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          data-active={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function SelectControl<T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <label className="v7-settings-select">
      <span className="v7-settings-visually-hidden">{ariaLabel}</span>
      <select
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" size={14} strokeWidth={1.7} />
    </label>
  );
}

function deletePolicyDescription(policy: DeletePolicy) {
  return policy === "forever"
    ? "Items are permanently removed immediately."
    : `Items remain recoverable in Trash for ${policy} days.`;
}
